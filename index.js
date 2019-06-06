var _ = require('lodash');
var sift = require('sift').default;

module.exports = (data, query, options) => {
	var settings = {
		remapArray: true,
		count: false,
		...options,
	};

	if (!_.isArray(data)) throw new Error('Input to sieve must be an array');

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

	var siftQuery = sift(siftFilter, options);

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
