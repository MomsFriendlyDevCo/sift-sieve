var _ = require('lodash');
var safeRegex = require('safe-regex2');
var sift = require('sift');

/**
* Recursively validate a query at any depth, throwing if it contains anything not permitted by the settings
* Rejects `$where` operators and function values unless `applyWhere` is true, and unsafe (ReDoS prone) regular expressions unless `applyUnsafeRegex` is true
* @param {*} query The query (or sub-query) to examine
* @param {Object} settings The sieve settings
* @param {boolean} settings.applyWhere Whether to permit `$where` operators and function values
* @param {boolean} settings.applyUnsafeRegex Whether to permit regular expressions with exponential backtracking
* @returns {void}
* @throws {Error} If the query contains a disallowed condition
*/
var validateQuery = (query, settings) => {
	if (_.isFunction(query)) {
		if (settings.applyWhere !== true) throw new Error('Function values are not permitted unless the `applyWhere` option is enabled');
	} else if (_.isRegExp(query)) {
		if (settings.applyUnsafeRegex !== true && !safeRegex(query)) throw new Error(`Unsafe regular expression "${query.source}" is not permitted unless the \`applyUnsafeRegex\` option is enabled`);
	} else if (Array.isArray(query)) {
		query.forEach(q => validateQuery(q, settings));
	} else if (_.isPlainObject(query)) {
		Object.keys(query).forEach(k => {
			if (k == '$where' && settings.applyWhere !== true) throw new Error('$where conditions are not permitted unless the `applyWhere` option is enabled');
			if (k == '$regex' && _.isString(query[k]) && settings.applyUnsafeRegex !== true && !safeRegex(query[k])) throw new Error(`Unsafe regular expression "${query[k]}" is not permitted unless the \`applyUnsafeRegex\` option is enabled`);
			validateQuery(query[k], settings);
		});
	}
};

module.exports = (data, query, options) => {
	var settings = {
		remapArray: true,
		count: false,
		applyWhere: false,
		applyUnsafeRegex: false,
		...options,
	};

	if (!_.isArray(data)) throw new Error('Input to sieve must be an array');
	if (query && !_.isPlainObject(query)) throw new Error('Query to sieve must be an object');

	// Empty queries {{{
	if (!query || _.isEmpty(query)) {
		if (settings.count) {
			return data.length;
		} else {
			return data; // No query given - return everything
		}
	}
	// }}}

	var siftFilter = _.omit(query, ['select', 'sort', 'limit', 'skip']);

	// Remap {id: ARRAY} into {id: {$in: ARRAY}} {{{
	if (settings.remapArray)
		Object.keys(siftFilter).forEach(k => {
			if (Array.isArray(siftFilter[k]))
				siftFilter[k] = {$in: siftFilter[k]};
		});
	// }}}

	validateQuery(siftFilter, settings);

	var siftQuery = sift(siftFilter, _.omit(options, ['remapArray', 'count', 'applyWhere', 'applyUnsafeRegex']));

	var count = 0; // Number of items that test positive in the output so far
	var skipped = 0;
	var res = data.filter(item => {
		// Apply limit {{{
		if (query.limit && count >= query.limit) { // Gone over limit?
			return false;
		}
		// }}}

		// Apply Sift (filters) {{{
		var siftResult = siftQuery(item);
		// }}}

		// Apply skip {{{
		if (siftResult && query.skip && ++skipped <= query.skip) {
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
	if (query.sort && !_.isEmpty(query.sort)) {
		res = _.orderBy(res, ..._(_.isString(query.sort) ? query.sort.split(/\s*,\s*/) : query.sort)
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
	if (query.select && !_.isEmpty(query.select)) {
		var fields = _.isString(query.select) ? query.select.split(/\s*,\s*/) : query.select;

		// Act as an exclusion selection?
		var isExclude = fields.some(field => field.startsWith('!') || field.startsWith('-'));

		if (isExclude) {
			fields = fields.map(field => {
				if (!field.startsWith('!') && !field.startsWith('-')) throw new Error('Invalid selection criteria, if using a select exclusion all fields must be exclusions');
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
