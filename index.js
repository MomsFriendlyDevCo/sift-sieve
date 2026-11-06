var _ = require('lodash');
var ret = require('ret');
var safeRegex = require('safe-regex2');
var sift = require('sift');

/**
* Error thrown for any invalid, unsafe or disallowed query
* Carries `status` / `statusCode` of 400 so it can be passed directly to an ExpressJS style error handler
*/
class SieveQueryError extends Error {
	/**
	* @param {string} message The error message, this should not contain unescaped or untruncated user input
	* @param {Object} [options] Additional Error options
	* @param {Error} [options.cause] The underlying error, if any
	*/
	constructor(message, options) {
		super(message, options);
		this.name = 'SieveQueryError';
		this.status = 400;
		this.statusCode = 400;
	}
}


/**
* Option keys consumed by sieve which should not be passed onto Sift
* @type {Array<string>}
*/
var sieveOptions = ['remapArray', 'count', 'applyWhere', 'applyUnsafeRegex', 'allowFields', 'literalFields', 'maxLimit', 'maxDepth', 'maxKeys', 'maxArrayLength', 'maxRegexLength'];


/**
* Path segments which are never permitted within a field path as they reach into the prototype chain
* @type {Array<string>}
*/
var blockedSegments = ['__proto__', 'constructor', 'prototype'];


/**
* Logical operators whose values are arrays of sub-queries
* @type {Array<string>}
*/
var logicalOperators = ['$and', '$or', '$nor'];


/**
* Safely quote user input for inclusion within an error message
* @param {*} value The value to quote
* @returns {string} The JSON quoted and truncated value
*/
var quote = value => JSON.stringify(_.truncate(String(value), {length: 64}));


/**
* Determine if a numeric limit setting is active
* @param {*} limit The limit setting
* @returns {boolean} True if the limit should be enforced
*/
var isLimited = limit => _.isFinite(limit) && limit > 0;


/**
* Determine if a parsed regular expression token tree contains an alternation group within an unbounded (or large) repetition
* This catches overlapping alternation such as `(a|a)*` which safe-regex2 does not detect
* @param {Object} token The `ret` token to examine
* @param {boolean} [inRepeat=false] Whether the token is already within a large repetition
* @returns {boolean} True if a quantified alternation was found
*/
var hasQuantifiedAlternation = (token, inRepeat = false) =>
	!_.isObject(token) ? false
	: token.type == ret.types.REPETITION ? hasQuantifiedAlternation(token.value, inRepeat || token.max > 10)
	: token.options ? (inRepeat && token.options.length > 1) || token.options.some(option => option.some(t => hasQuantifiedAlternation(t, inRepeat)))
	: token.stack ? token.stack.some(t => hasQuantifiedAlternation(t, inRepeat))
	: false;


/**
* Validate a regular expression (as a string or RegExp) against the settings
* @param {string|RegExp} pattern The regular expression to examine
* @param {Object} settings The sieve settings
* @returns {void}
* @throws {SieveQueryError} If the expression is too long, unparsable or unsafe
*/
var validateRegex = (pattern, settings) => {
	var source = _.isRegExp(pattern) ? pattern.source : pattern;
	if (isLimited(settings.maxRegexLength) && source.length > settings.maxRegexLength) throw new SieveQueryError(`Regular expression exceeds the maximum length of ${settings.maxRegexLength} (\`maxRegexLength\` option)`);
	if (settings.applyUnsafeRegex === true) return;

	var tokens = _.attempt(()=> ret(source));
	if (_.isError(tokens)) throw new SieveQueryError('Invalid regular expression', {cause: tokens});
	if (!safeRegex(source) || hasQuantifiedAlternation(tokens)) throw new SieveQueryError('Unsafe regular expression is not permitted unless the `applyUnsafeRegex` option is enabled');
};


/**
* Recursively validate the structure of a query at any depth, throwing if it contains anything not permitted by the settings
* Rejects `$where` operators and function values unless `applyWhere` is true, unsafe (ReDoS prone) regular expressions unless `applyUnsafeRegex` is true and anything exceeding the size limits
* @param {*} query The query (or sub-query) to examine
* @param {Object} settings The sieve settings
* @param {Object} [state] Running totals across the whole query
* @param {number} [state.keys=0] Number of object keys seen so far
* @param {number} [depth=1] The current nesting depth
* @returns {void}
* @throws {SieveQueryError} If the query contains a disallowed condition
*/
var validateQuery = (query, settings, state = {keys: 0}, depth = 1) => {
	if (isLimited(settings.maxDepth) && depth > settings.maxDepth) throw new SieveQueryError(`Query exceeds the maximum nesting depth of ${settings.maxDepth} (\`maxDepth\` option)`);

	if (_.isFunction(query)) {
		if (settings.applyWhere !== true) throw new SieveQueryError('Function values are not permitted unless the `applyWhere` option is enabled');
	} else if (_.isRegExp(query)) {
		validateRegex(query, settings);
	} else if (Array.isArray(query)) {
		if (isLimited(settings.maxArrayLength) && query.length > settings.maxArrayLength) throw new SieveQueryError(`Query array exceeds the maximum length of ${settings.maxArrayLength} (\`maxArrayLength\` option)`);
		query.forEach(q => validateQuery(q, settings, state, depth + 1));
	} else if (_.isPlainObject(query)) {
		var keys = Object.keys(query);
		state.keys += keys.length;
		if (isLimited(settings.maxKeys) && state.keys > settings.maxKeys) throw new SieveQueryError(`Query exceeds the maximum number of keys of ${settings.maxKeys} (\`maxKeys\` option)`);

		keys.forEach(k => {
			if (k == '$where' && settings.applyWhere !== true) throw new SieveQueryError('$where conditions are not permitted unless the `applyWhere` option is enabled');
			if (k == '$regex' && _.isString(query[k])) validateRegex(query[k], settings);
			validateQuery(query[k], settings, state, depth + 1);
		});
	}
};


/**
* Validate a single field path against the blocked segments and (optionally) the allowed fields
* @param {string} path The dotted field path
* @param {Object} settings The sieve settings
* @param {boolean} [checkAllowed=true] Whether to also check the path against `settings.allowFields`
* @returns {void}
* @throws {SieveQueryError} If the field is not permitted
*/
var validateField = (path, settings, checkAllowed = true) => {
	if (path.split('.').some(segment => blockedSegments.includes(segment))) throw new SieveQueryError(`Field ${quote(path)} is not permitted`);
	if (
		checkAllowed
		&& settings.allowFields
		&& !settings.allowFields.some(field => path == field || path.startsWith(field + '.'))
	) throw new SieveQueryError(`Field ${quote(path)} is not permitted (\`allowFields\` option)`);
};


/**
* Determine if a value is a primitive literal or an array of primitive literals
* @param {*} value The value to examine
* @returns {boolean} True if the value contains no operators, objects or expressions
*/
var isLiteral = value =>
	Array.isArray(value) ? value.every(v => v === null || ['string', 'number', 'boolean'].includes(typeof v))
	: value === null || ['string', 'number', 'boolean'].includes(typeof value);


/**
* Validate the value given against a field path, recursing into any sub-queries
* @param {string} path The dotted field path
* @param {*} value The value or operator object given for the field
* @param {Object} settings The sieve settings
* @returns {void}
* @throws {SieveQueryError} If the field or its value is not permitted
*/
var validateFieldValue = (path, value, settings) => {
	var isElemMatchContainer = _.isPlainObject(value)
		&& _.isEqual(Object.keys(value), ['$elemMatch'])
		&& settings.allowFields
		&& settings.allowFields.some(field => field.startsWith(path + '.'));

	validateField(path, settings, !isElemMatchContainer); // Containers of allowed fields may use $elemMatch, sub-fields are checked below

	(settings.literalFields || []).forEach(field => {
		if (path.startsWith(field + '.')) throw new SieveQueryError(`Field ${quote(path)} is not permitted (\`literalFields\` option)`);
		if (
			(path == field || field.startsWith(path + '.'))
			&& !isLiteral(value)
		) throw new SieveQueryError(`Field ${quote(path)} only accepts literal values (\`literalFields\` option)`);
	});

	if (_.isPlainObject(value))
		Object.keys(value).forEach(op => {
			if (op == '$elemMatch' && _.isPlainObject(value[op])) {
				validateFields(value[op], settings, path + '.');
			} else if (op == '$not') {
				validateFieldValue(path, value[op], settings);
			}
		});
};


/**
* Recursively validate all field paths used within a query
* @param {Object} query The query (or sub-query) to examine
* @param {Object} settings The sieve settings
* @param {string} [prefix=''] Prefix to prepend to all field paths, used within `$elemMatch`
* @returns {void}
* @throws {SieveQueryError} If any field or field value is not permitted
*/
var validateFields = (query, settings, prefix = '') =>
	Object.keys(query).forEach(k => {
		if (logicalOperators.includes(k)) {
			_.values(query[k])
				.filter(_.isPlainObject)
				.forEach(subQuery => validateFields(subQuery, settings, prefix));
		} else if (!k.startsWith('$')) {
			validateFieldValue(prefix + k, query[k], settings);
		}
	});


/**
* Parse a limit / skip value into a non-negative integer
* @param {*} value The raw value, which may be a number or numeric string
* @param {string} name The name of the parameter, used in error messages
* @returns {number} The parsed integer, zero if not specified
* @throws {SieveQueryError} If the value is not a non-negative integer
*/
var parseCount = (value, name) =>
	_.isNil(value) || value === false || value === '' ? 0
	: Number.isSafeInteger(value) && value >= 0 ? value
	: _.isString(value) && /^\d{1,15}$/.test(value) ? Number.parseInt(value, 10)
	: (()=> { throw new SieveQueryError(`Invalid ${name}, must be a non-negative integer`) })();


/**
* Parse a select / sort value into an array of field strings
* @param {*} value The raw value, which may be a CSV string or an array of strings
* @param {string} name The name of the parameter, used in error messages
* @returns {Array<string>} The parsed fields, empty if not specified
* @throws {SieveQueryError} If the value is not a string or array of strings
*/
var parseFieldList = (value, name) =>
	_.isNil(value) || value === false ? []
	: _.isString(value) ? value.split(/\s*,\s*/).filter(Boolean)
	: Array.isArray(value) && value.every(_.isString) ? value.filter(Boolean)
	: (()=> { throw new SieveQueryError(`Invalid ${name}, must be a string or array of strings`) })();


/**
* Filter, sort, page and select an array of data using a Sift / Mongo style query
* @param {Array} data The data to filter
* @param {Object} [query] The query to apply, may include the reserved `select`, `sort`, `limit` and `skip` keys
* @param {Object} [options] Options, see the README for the full list. Any unrecognised options are passed onto Sift
* @returns {Array|number} The filtered data or, if `options.count` is set, the number of matching items
* @throws {SieveQueryError} If the query is invalid, unsafe or disallowed
*/
module.exports = (data, query, options) => {
	var settings = {
		remapArray: true,
		count: false,
		applyWhere: false,
		applyUnsafeRegex: false,
		allowFields: null,
		literalFields: [],
		maxLimit: 0,
		maxDepth: 16,
		maxKeys: 500,
		maxArrayLength: 500,
		maxRegexLength: 256,
		...options,
	};

	if (!_.isArray(data)) throw new Error('Input to sieve must be an array');
	if (query && !_.isPlainObject(query)) throw new SieveQueryError('Query to sieve must be an object');
	if (!query) query = {};

	var limit = parseCount(query.limit, 'limit');
	var skip = parseCount(query.skip, 'skip');
	if (!settings.count && isLimited(settings.maxLimit) && (!limit || limit > settings.maxLimit)) limit = settings.maxLimit;

	var sortFields = parseFieldList(query.sort, 'sort');
	sortFields.forEach(field => validateField(field.replace(/^[+-]/, ''), settings));

	var selectFields = parseFieldList(query.select, 'select');
	selectFields.forEach(field => validateField(field.replace(/^[!-]/, ''), settings, false));

	var siftFilter = _.omit(query, ['select', 'sort', 'limit', 'skip']);

	validateQuery(siftFilter, settings);
	validateFields(siftFilter, settings);

	// Remap {id: ARRAY} into {id: {$in: ARRAY}} {{{
	if (settings.remapArray)
		Object.keys(siftFilter).forEach(k => {
			if (Array.isArray(siftFilter[k]) && !k.startsWith('$'))
				siftFilter[k] = {$in: siftFilter[k]};
		});
	// }}}

	var siftQuery = _.attempt(()=> sift(siftFilter, _.omit(options, sieveOptions)));
	if (_.isError(siftQuery)) throw new SieveQueryError(`Invalid query: ${quote(siftQuery.message)}`, {cause: siftQuery});

	var count = 0; // Number of items that test positive in the output so far
	var skipped = 0;
	var res = data.filter(item => {
		// Apply limit {{{
		if (limit && count >= limit) { // Gone over limit?
			return false;
		}
		// }}}

		// Apply Sift (filters) {{{
		var siftResult = _.attempt(siftQuery, item);
		if (_.isError(siftResult)) throw new SieveQueryError(`Invalid query: ${quote(siftResult.message)}`, {cause: siftResult});
		// }}}

		// Apply skip {{{
		if (siftResult && skip && ++skipped <= skip) {
			return false; // Still within skip range
		} else if (siftResult) {
			count++;
			return siftResult;
		}
		// }}}

		return siftResult;
	});

	if (settings.count) return res.length;

	// Apply sort {{{
	if (sortFields.length) {
		res = _.orderBy(res, ..._(sortFields)
			.map(o =>
				o.startsWith('-') ? [o.substr(1), 'desc']
				: o.startsWith('+') ? [o.substr(1), 'asc']
				: [o, 'asc']
			)
			.unzip()
			.value()
		);
	}
	// }}}

	// Apply select {{{
	if (selectFields.length) {
		var fields = selectFields;

		// Act as an exclusion selection?
		var isExclude = fields.some(field => field.startsWith('!') || field.startsWith('-'));

		if (isExclude) {
			fields = fields.map(field => {
				if (!field.startsWith('!') && !field.startsWith('-')) throw new SieveQueryError('Invalid selection criteria, if using a select exclusion all fields must be exclusions');
				return field.substr(1);
			});

			res = res.map(o => _.omit(o, fields));
		} else {
			res = res.map(o => _.pick(o, fields));
		}
	}
	// }}}

	return res;
};

module.exports.SieveQueryError = SieveQueryError;
