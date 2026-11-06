var _ = require('lodash');
var expect = require('chai').expect;
var qs = require('qs');
var sieve = require('..');

describe('sift-sieve', ()=> {

	var data = [
		{name: 'Joe Random', age: 22, email: 'joe@mfdc.biz'},
		{name: 'Jane Random', age: 25, email: 'jane@mfdc.biz'},
		{name: 'Nora Clarke', age: 35, email: 'norah@gmail.com'},
		{name: 'Michael Chaos', age: 35, email: 'michael@gmail.com'},
	];

	it('should perform basic sift operations', ()=> {
		expect(sieve(data)).to.deep.equal(data);
		expect(sieve(data, {})).to.deep.equal(data);
		expect(sieve(data, {name: 'Joe Random'})).to.deep.equal(data.filter(d => d.name == 'Joe Random'));
		expect(sieve(data, {age: {$gt: 25}})).to.deep.equal(data.filter(d => d.age > 25));
		expect(sieve(data, {name: {$regex: '^j', $options: 'i'}})).to.deep.equal(data.filter(d => /^j/i.test(d.name)));
	});


	it('should support "count"', ()=> {
		expect(sieve(data, {}, {count: true})).to.deep.equal(data.length);
		expect(sieve(data, {age: {$gt: 25}}, {count: true})).to.deep.equal(data.filter(d => d.age > 25).length);
		expect(sieve([], {}, {count: true})).to.equal(0);
	});


	it('should support "limit"', ()=> {
		expect(sieve(data, {limit: 0})).to.deep.equal(data);
		expect(sieve(data, {limit: false})).to.deep.equal(data);
		expect(sieve(data, {limit: 1})).to.deep.equal(data.slice(0, 1));
	});


	it('should support "skip"', ()=> {
		expect(sieve(data, {skip: 0})).to.deep.equal(data);
		expect(sieve(data, {skip: false})).to.deep.equal(data);
		expect(sieve(data, {skip: 2})).to.deep.equal(data.slice(2));
		expect(sieve(data, {skip: 999})).to.deep.equal([]);
		expect(sieve(data, {skip: 1, limit: 1})).to.deep.equal(data.slice(1, 2));
	});


	it('should support "sort"', ()=> {
		expect(sieve(data, {sort: ''})).to.deep.equal(data);
		expect(sieve(data, {sort: false})).to.deep.equal(data);
		expect(sieve(data, {sort: 'name'})).to.deep.equal(_.sortBy(data, 'name'));
		expect(sieve(data, {sort: '-age'})).to.deep.equal(_.orderBy(data, ['age'], ['desc']));
		expect(sieve(data, {sort: ['name', '-age']})).to.deep.equal(_.orderBy(data, ['name', 'age'], ['asc', 'desc']));
		expect(sieve(data, {sort: 'name,-age'})).to.deep.equal(_.orderBy(data, ['name', 'age'], ['asc', 'desc']));
	});


	it('should support "select"', ()=> {
		expect(sieve(data, {select: []})).to.deep.equal(data);
		expect(sieve(data, {select: ''})).to.deep.equal(data);
		expect(sieve(data, {select: false})).to.deep.equal(data);
		expect(sieve(data, {select: 'name'})).to.deep.equal(data.map(d => ({name: d.name})));
		expect(sieve(data, {select: '!name'})).to.deep.equal(data.map(d => ({age: d.age, email: d.email})));
		expect(sieve(data, {select: '!name,!age'})).to.deep.equal(data.map(d => ({email: d.email})));
		expect(sieve(data, {select: ['!name', '-age']})).to.deep.equal(data.map(d => ({email: d.email})));
		expect(()=> sieve(data, {select: ['!name', 'age']})).to.throw();
	});


	it('should reject "$where" unless applyWhere is enabled', ()=> {
		expect(()=> sieve(data, {$where: 'this.age > 25'})).to.throw(/\$where/);
		expect(()=> sieve(data, {$where: 'this.age > 25'}, {applyWhere: false})).to.throw(/\$where/);
		expect(()=> sieve(data, {$where: 'this.age > 25'}, {applyWhere: 'true'})).to.throw(/\$where/);
		expect(()=> sieve(data, {$or: [{name: 'Joe Random'}, {$where: 'this.age > 25'}]})).to.throw(/\$where/);
		expect(()=> sieve(data, {$and: [{$or: [{$where: 'this.age > 25'}]}]})).to.throw(/\$where/);
		expect(sieve(data, {$where: 'this.age > 25'}, {applyWhere: true})).to.deep.equal(data.filter(d => d.age > 25));
		expect(sieve(data, {$where: function() { return this.age > 25 }}, {applyWhere: true})).to.deep.equal(data.filter(d => d.age > 25));
	});


	it('should support top-level logical operators with the default remapArray setting', ()=> {
		expect(sieve(data, {$or: [{name: 'Joe Random'}, {age: 35}]})).to.deep.equal(data.filter(d => d.name == 'Joe Random' || d.age == 35));
		expect(sieve(data, {$and: [{age: 35}, {email: {$regex: '^nora'}}]})).to.deep.equal(data.filter(d => d.age == 35 && /^nora/.test(d.email)));
		expect(sieve(data, {$nor: [{age: 35}]})).to.deep.equal(data.filter(d => d.age != 35));
	});


	it('should reject non-object queries', ()=> {
		expect(()=> sieve(data, '$where')).to.throw();
		expect(()=> sieve(data, 'this.age > 25')).to.throw();
		expect(()=> sieve(data, 123)).to.throw();
		expect(()=> sieve(data, [{$where: 'this.age > 25'}])).to.throw();
		expect(()=> sieve(data, ()=> true)).to.throw();
		expect(()=> sieve(data, /Joe/)).to.throw();
		expect(sieve(data)).to.deep.equal(data);
		expect(sieve(data, null)).to.deep.equal(data);
	});


	describe('injection resistance', ()=> {

		/**
		* Payload which flags the global canary if it is ever evaluated
		* @type {string}
		*/
		var payload = 'globalThis.__sieveCanary = true; return true';


		/**
		* Run a sieve call and report whether the canary payload was ever evaluated
		* Errors thrown by the call are swallowed - only evaluation matters here
		* @param {Function} fn Function wrapping the sieve call to examine
		* @returns {boolean} True if the canary was tripped
		*/
		var tripped = fn => {
			globalThis.__sieveCanary = false;
			_.attempt(fn);
			let result = globalThis.__sieveCanary === true;
			delete globalThis.__sieveCanary;
			return result;
		};


		afterEach(()=> {
			delete Object.prototype.polluted;
		});


		it('should never evaluate string $where payloads by default', ()=> {
			expect(tripped(()=> sieve(data, {$where: payload}))).to.be.false;
			expect(tripped(()=> sieve(data, {$where: `(function() { ${payload} })()`}))).to.be.false;
			expect(tripped(()=> sieve(data, {$where: `eval(${JSON.stringify(payload)})`}))).to.be.false;
			expect(tripped(()=> sieve(data, {$where: `new Function(${JSON.stringify(payload)})()`}))).to.be.false;
		});


		it('should never evaluate function $where payloads by default', ()=> {
			expect(tripped(()=> sieve(data, {$where: function() { globalThis.__sieveCanary = true; return true }}))).to.be.false;
			expect(tripped(()=> sieve(data, {$where: ()=> { globalThis.__sieveCanary = true; return true }}))).to.be.false;
		});


		it('should only accept a literal boolean true for applyWhere', ()=> {
			[1, 'true', 'yes', {}, [], [true], ()=> true].forEach(applyWhere => {
				expect(()=> sieve(data, {$where: payload}, {applyWhere})).to.throw(/\$where/);
				expect(tripped(()=> sieve(data, {$where: payload}, {applyWhere}))).to.be.false;
			});
		});


		it('should detect $where hidden within nested operators', ()=> {
			[
				{$or: [{$where: payload}]},
				{$nor: [{$where: payload}]},
				{$and: [{$or: [{$and: [{$where: payload}]}]}]},
				{$or: [[{$where: payload}]]},
				{$or: {0: {$where: payload}}},
				{age: {$not: {$where: payload}}},
				{tags: {$elemMatch: {$where: payload}}},
				{name: {$where: payload}},
			].forEach(query => {
				expect(()=> sieve(data, query), JSON.stringify(query)).to.throw(/\$where/);
				expect(tripped(()=> sieve(data, query)), JSON.stringify(query)).to.be.false;
			});
		});


		it('should detect $where when it arrives via escaped or parsed keys', ()=> {
			expect(()=> sieve(data, JSON.parse('{"\\u0024where": "globalThis.__sieveCanary = true"}'))).to.throw(/\$where/);
			expect(()=> sieve(data, {'\x24where': payload})).to.throw(/\$where/);
			expect(()=> sieve(data, {['$' + 'where']: payload})).to.throw(/\$where/);
			expect(()=> sieve(data, JSON.parse('{"__proto__": {"$where": "globalThis.__sieveCanary = true"}}'))).to.throw(/\$where/);
			expect(()=> sieve(data, JSON.parse('{"$or": [{"__proto__": {"$where": "globalThis.__sieveCanary = true"}}]}'))).to.throw(/\$where/);

			var nullProto = Object.create(null);
			nullProto.$where = payload;
			expect(()=> sieve(data, {$or: [nullProto]})).to.throw(/\$where/);
		});


		it('should not evaluate $where lookalike keys', ()=> {
			[
				{$WHERE: payload},
				{$Where: payload},
				{' $where': payload},
				{'$where ': payload},
				{'＄where': payload}, // Fullwidth dollar
				{'name.$where': payload},
				{'$where\u0000': payload},
			].forEach(query => {
				expect(tripped(()=> sieve(data, query)), JSON.stringify(query)).to.be.false;
			});
		});


		it('should not evaluate $where hidden in inherited or class-instance properties', ()=> {
			class Query {
				constructor() {
					this.$where = payload;
				}
			}

			expect(tripped(()=> sieve(data, Object.create({$where: payload})))).to.be.false;
			expect(tripped(()=> sieve(data, {$or: [Object.create({$where: payload})]}, {remapArray: false}))).to.be.false;
			expect(tripped(()=> sieve(data, new Query()))).to.be.false;
			expect(tripped(()=> sieve(data, {$or: [new Query()]}, {remapArray: false}))).to.be.false;
		});


		it('should not evaluate functions supplied as field values', ()=> {
			var evil = function() { globalThis.__sieveCanary = true; return true };

			expect(tripped(()=> sieve(data, {age: evil}))).to.be.false;
			expect(tripped(()=> sieve(data, {age: {$eq: evil}}))).to.be.false;
			expect(tripped(()=> sieve(data, {$or: [{age: evil}]}, {remapArray: false}))).to.be.false;
			expect(()=> sieve(data, {age: evil})).to.throw(/applyWhere/);
			expect(()=> sieve(data, {age: {$in: [22, evil]}})).to.throw(/applyWhere/);
		});


		it('should allow function values when applyWhere is enabled', ()=> {
			expect(sieve(data, {age: v => v > 25}, {applyWhere: true})).to.deep.equal(data.filter(d => d.age > 25));
		});


		it('should reject other code-executing operators', ()=> {
			expect(()=> sieve(data, {$expr: payload})).to.throw();
			expect(()=> sieve(data, {$function: {body: payload, args: [], lang: 'js'}})).to.throw();
			expect(()=> sieve(data, {$accumulator: {init: payload}})).to.throw();
			expect(tripped(()=> sieve(data, {$function: {body: payload, args: [], lang: 'js'}}))).to.be.false;
		});


		it('should treat Base64 encoded payloads as inert strings', ()=> {
			var b64 = Buffer.from(payload).toString('base64');
			var b64Where = Buffer.from('$where').toString('base64');
			var b64Query = Buffer.from(JSON.stringify({$where: payload})).toString('base64');

			expect(tripped(()=> sieve(data, {name: b64}))).to.be.false;
			expect(sieve(data, {name: b64})).to.deep.equal([]);
			expect(tripped(()=> sieve(data, {[b64Where]: payload}))).to.be.false;
			expect(sieve(data, {[b64Where]: payload})).to.deep.equal([]);
			expect(tripped(()=> sieve(data, {name: {$regex: b64}}))).to.be.false;
			expect(tripped(()=> sieve(data, {$or: [{name: b64Query}]}, {remapArray: false}))).to.be.false;
			expect(tripped(()=> sieve(data, {name: `data:text/javascript;base64,${b64}`}))).to.be.false;
			expect(sieve(data, {name: `data:text/javascript;base64,${b64}`})).to.deep.equal([]);
		});


		it('should treat other encoded payloads as inert strings', ()=> {
			[
				encodeURIComponent(JSON.stringify({$where: payload})),
				Buffer.from(payload).toString('hex'),
				payload.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
				`\${${payload}}`,
				`{{constructor.constructor('${payload}')()}}`,
			].forEach(value => {
				expect(tripped(()=> sieve(data, {name: value})), value).to.be.false;
				expect(sieve(data, {name: value}), value).to.deep.equal([]);
			});
		});


		it('should not evaluate code via $regex', ()=> {
			expect(tripped(()=> sieve(data, {name: {$regex: '(?{globalThis.__sieveCanary=true})'}}))).to.be.false;
			expect(tripped(()=> sieve(data, {name: {$regex: payload}}))).to.be.false;
			expect(tripped(()=> sieve(data, {name: {$regex: '.*', $options: payload}}))).to.be.false;
		});


		it('should not hang on catastrophic-backtracking (ReDoS) regular expressions', function() {
			this.timeout(30 * 1000);

			var start = Date.now();
			_.attempt(()=> sieve([{name: 'a'.repeat(25) + '!'}], {name: {$regex: '^(a+)+$'}}));
			expect(Date.now() - start).to.be.below(250);
		});


		it('should reject unsafe regular expressions unless applyUnsafeRegex is enabled', ()=> {
			[
				{name: {$regex: '^(a+)+$'}},
				{name: {$regex: /(x+x+)+y/}},
				{name: /^(a+)+$/},
				{name: {$in: [/^(a+)+$/]}},
				{name: {$not: /(a*)*b/}},
				{name: {$elemMatch: {$regex: '(.*a){12}'}}},
			].forEach(query => {
				expect(()=> sieve(data, query), JSON.stringify(query)).to.throw(/applyUnsafeRegex/);
				[1, 'true', {}].forEach(applyUnsafeRegex =>
					expect(()=> sieve(data, query, {applyUnsafeRegex})).to.throw(/applyUnsafeRegex/)
				);
				expect(()=> sieve(data, query, {applyUnsafeRegex: true})).to.not.throw();
			});
		});


		it('should allow safe regular expressions', ()=> {
			expect(sieve(data, {name: {$regex: '^j', $options: 'i'}})).to.deep.equal(data.filter(d => /^j/i.test(d.name)));
			expect(sieve(data, {name: /random$/i})).to.deep.equal(data.filter(d => /random$/i.test(d.name)));
			expect(sieve(data, {email: {$in: [/gmail/, /^joe/]}})).to.deep.equal(data.filter(d => /gmail|^joe/.test(d.email)));
		});


		it('should throw rather than hang on deeply nested queries', ()=> {
			var query = {};
			var cursor = query;
			_.times(20000, ()=> {
				cursor.$and = [{}];
				cursor = cursor.$and[0];
			});

			expect(()=> sieve(data, query, {remapArray: false})).to.throw();
		});


		it('should not allow prototype pollution via the query', ()=> {
			expect(()=> sieve(data, JSON.parse('{"__proto__": {"polluted": true}}'))).to.throw(sieve.SieveQueryError);
			expect(()=> sieve(data, JSON.parse('{"constructor": {"prototype": {"polluted": true}}}'))).to.throw(sieve.SieveQueryError);
			expect(()=> sieve(data, JSON.parse('{"$or": [{"__proto__": {"polluted": true}}]}'), {remapArray: false})).to.throw(sieve.SieveQueryError);
			expect({}.polluted).to.be.undefined;
		});


		it('should not allow prototype pollution via select / sort', ()=> {
			[
				{select: ['__proto__.polluted', 'constructor.prototype.polluted']},
				{select: '__proto__,constructor,prototype'},
				{select: '!__proto__,!constructor.prototype'},
				{select: '__proto__'},
				{select: 'constructor'},
				{sort: '__proto__.polluted,-constructor.prototype'},
				{sort: '-constructor'},
			].forEach(query => {
				expect(()=> sieve(data, query), JSON.stringify(query)).to.throw(sieve.SieveQueryError);
			});
			expect({}.polluted).to.be.undefined;
		});


		it('should not route $where through the reserved select / sort / limit / skip keys', ()=> {
			expect(tripped(()=> sieve(data, {select: {$where: payload}}))).to.be.false;
			expect(tripped(()=> sieve(data, {sort: {$where: payload}}))).to.be.false;
			expect(tripped(()=> sieve(data, {limit: {$where: payload}}))).to.be.false;
			expect(tripped(()=> sieve(data, {skip: {$where: payload}}))).to.be.false;
		});


		it('should not mutate the caller\'s query or options', ()=> {
			var query = {name: ['Joe Random', 'Jane Random'], $or: [{age: 22}]};
			var options = {applyWhere: false, count: false};
			var queryCopy = _.cloneDeep(query);
			var optionsCopy = _.cloneDeep(options);

			_.attempt(()=> sieve(data, query, options));
			expect(query).to.deep.equal(queryCopy);
			expect(options).to.deep.equal(optionsCopy);
		});

	});


	describe('hostile input', ()=> {

		var users = [
			{name: 'Joe', age: 22, token: 's3cr3t-joe', tags: [{label: 'admin', secret: 'x1'}], profile: {city: 'Sydney', passwordHash: 'abc123'}},
			{name: 'Jane', age: 35, token: 's3cr3t-jane', tags: [{label: 'user', secret: 'y2'}], profile: {city: 'Perth', passwordHash: 'zzz999'}},
		];


		/**
		* Assert that a sieve call either succeeds or fails only with a SieveQueryError
		* @param {Function} fn Function wrapping the sieve call
		* @param {string} [label] Label to show on failure
		* @returns {*} The result of the call, or the SieveQueryError thrown
		*/
		var expectSafe = (fn, label) => {
			let result = _.attempt(fn);
			if (_.isError(result)) expect(result, `${label}: ${result.stack}`).to.be.an.instanceOf(sieve.SieveQueryError);
			return result;
		};


		/**
		* Parse a query string the same way ExpressJS (v4, "extended" query parser) populates `req.query`
		* @param {string} query The raw query string, without the leading '?'
		* @param {Object} [options] Additional qs options
		* @returns {Object} The parsed query
		*/
		var parseQuery = (query, options) => qs.parse(query, options);


		afterEach(()=> {
			delete Object.prototype.polluted;
		});


		describe('operator injection (literalFields)', ()=> {

			it('should reject operator objects against literal-only fields', ()=> {
				[
					{token: {$ne: 'x'}},
					{token: {$gt: ''}},
					{token: {$exists: 'false'}},
					{token: {$regex: '^s3cr3t'}},
					{token: {$in: [{$ne: 'x'}]}},
					{token: {$not: {$eq: 'x'}}},
					{token: /s3cr3t/},
					{$or: [{token: {$ne: 'x'}}]},
					{$and: [{$nor: [{token: {$ne: 'x'}}]}]},
				].forEach(query => {
					expect(()=> sieve(users, query, {literalFields: ['token'], remapArray: false}), JSON.stringify(query)).to.throw(sieve.SieveQueryError, /literalFields/);
				});
			});


			it('should reject sub-paths of literal-only fields', ()=> {
				expect(()=> sieve(users, {'token.length': 11}, {literalFields: ['token']})).to.throw(sieve.SieveQueryError, /literalFields/);
				expect(()=> sieve(users, {'token.0': 's'}, {literalFields: ['token']})).to.throw(sieve.SieveQueryError, /literalFields/);
			});


			it('should reject object matches against ancestors of literal-only fields', ()=> {
				expect(()=> sieve(users, {profile: {passwordHash: 'abc123', city: 'Sydney'}}, {literalFields: ['profile.passwordHash']})).to.throw(sieve.SieveQueryError, /literalFields/);
				expect(sieve(users, {'profile.passwordHash': 'abc123'}, {literalFields: ['profile.passwordHash']})).to.deep.equal([users[0]]);
			});


			it('should still accept literal values against literal-only fields', ()=> {
				expect(sieve(users, {token: 's3cr3t-joe'}, {literalFields: ['token']})).to.deep.equal([users[0]]);
				expect(sieve(users, {token: ['s3cr3t-joe', 'nope']}, {literalFields: ['token']})).to.deep.equal([users[0]]);
				expect(sieve(users, {token: 'x', age: {$gt: 1}}, {literalFields: ['token']})).to.deep.equal([]);
			});

		});


		describe('data leak oracles (allowFields)', ()=> {

			var options = {allowFields: ['name', 'age', 'profile.city', 'tags.label']};


			it('should reject filtering on fields not in allowFields', ()=> {
				[
					{token: 's3cr3t-joe'},
					{'profile.passwordHash': {$regex: '^a'}},
					{'profile.passwordHash': {$lt: 'm'}},
					{profile: {city: 'Sydney', passwordHash: 'abc123'}},
					{'tags.secret': 'x1'},
					{tags: {$elemMatch: {secret: 'x1'}}},
					{tags: {$elemMatch: {$or: [{secret: 'x1'}]}}},
					{$or: [{name: 'Joe'}, {token: {$exists: true}}]},
					{$nor: [{token: 's3cr3t-joe'}]},
					{token: {$not: {$regex: '^z'}}},
					{namex: 'Joe'},
				].forEach(query => {
					expect(()=> sieve(users, query, {...options, remapArray: false}), JSON.stringify(query)).to.throw(sieve.SieveQueryError, /allowFields/);
				});
			});


			it('should reject sorting on fields not in allowFields', ()=> {
				expect(()=> sieve(users, {sort: 'token'}, options)).to.throw(sieve.SieveQueryError, /allowFields/);
				expect(()=> sieve(users, {sort: ['name', '-profile.passwordHash']}, options)).to.throw(sieve.SieveQueryError, /allowFields/);
				expect(()=> sieve(users, {sort: '+token'}, options)).to.throw(sieve.SieveQueryError, /allowFields/);
			});


			it('should report counts only for allowed fields', ()=> {
				expect(()=> sieve(users, {token: {$regex: '^s3cr3t-j'}}, {...options, count: true})).to.throw(sieve.SieveQueryError, /allowFields/);
				expect(sieve(users, {age: {$gt: 30}}, {...options, count: true})).to.equal(1);
			});


			it('should accept allowed fields and their sub-paths', ()=> {
				expect(sieve(users, {name: 'Joe'}, options)).to.deep.equal([users[0]]);
				expect(sieve(users, {'profile.city': 'Perth', sort: '-age'}, options)).to.deep.equal([users[1]]);
				expect(sieve(users, {tags: {$elemMatch: {label: 'admin'}}}, {allowFields: ['tags.label']})).to.deep.equal([users[0]]);
				expect(sieve(users, {'profile.city': 'Sydney'}, {allowFields: ['profile']})).to.deep.equal([users[0]]);
			});


			it('should not restrict select to allowFields', ()=> {
				expect(sieve(users, {name: 'Joe', select: 'token'}, options)).to.deep.equal([{token: 's3cr3t-joe'}]);
			});


			it('should allow all fields when allowFields is not set', ()=> {
				expect(sieve(users, {token: 's3cr3t-joe'})).to.deep.equal([users[0]]);
			});

		});


		describe('prototype chain paths', ()=> {

			it('should always reject __proto__ / constructor / prototype path segments', ()=> {
				[
					{'constructor.name': 'Object'},
					{constructor: {$exists: true}},
					{'profile.__proto__.polluted': 1},
					{'profile.constructor.prototype': {$exists: true}},
					{prototype: 1},
					{tags: {$elemMatch: {'constructor.name': 'Object'}}},
					{$or: [{'constructor.name': 'Object'}]},
					{sort: 'constructor.name'},
					{select: 'profile.__proto__'},
				].forEach(query => {
					expect(()=> sieve(users, query, {remapArray: false}), JSON.stringify(query)).to.throw(sieve.SieveQueryError, /not permitted/);
				});
			});


			it('should allow segments which merely contain blocked words', ()=> {
				var data = [{constructorName: 'a', myprototype: 'b'}];
				expect(sieve(data, {constructorName: 'a', myprototype: 'b'})).to.deep.equal(data);
			});

		});


		describe('paging and projection types', ()=> {

			it('should accept numeric limit and skip values', ()=> {
				expect(sieve(users, {limit: 1})).to.deep.equal([users[0]]);
				expect(sieve(users, {limit: '1'})).to.deep.equal([users[0]]);
				expect(sieve(users, {skip: '1'})).to.deep.equal([users[1]]);
				expect(sieve(users, {limit: '0', skip: 0})).to.deep.equal(users);
				expect(sieve(users, {limit: '', skip: null})).to.deep.equal(users);
			});


			it('should reject non-integer limit and skip values', ()=> {
				['abc', '-1', -1, 1.5, '1.5', '1e3', ' 1', '0x10', ['1', '2'], {$gt: '0'}, NaN, Infinity, true, '9'.repeat(20)].forEach(value => {
					expect(()=> sieve(users, {limit: value}), `limit=${JSON.stringify(value)}`).to.throw(sieve.SieveQueryError, /limit/);
					expect(()=> sieve(users, {skip: value}), `skip=${JSON.stringify(value)}`).to.throw(sieve.SieveQueryError, /skip/);
				});
			});


			it('should cap results via maxLimit', ()=> {
				var many = _.times(50, i => ({i}));
				expect(sieve(many, {}, {maxLimit: 10})).to.have.length(10);
				expect(sieve(many, {limit: 999}, {maxLimit: 10})).to.have.length(10);
				expect(sieve(many, {limit: 5}, {maxLimit: 10})).to.have.length(5);
				expect(sieve(many, {skip: 45}, {maxLimit: 10})).to.have.length(5);
				expect(sieve(many, {}, {maxLimit: 10, count: true})).to.equal(50);
			});


			it('should reject non-string select and sort values', ()=> {
				[{a: '1'}, [{a: 1}], ['name', 1], 5, true, ()=> 'name'].forEach(value => {
					expect(()=> sieve(users, {select: value}), `select=${JSON.stringify(value)}`).to.throw(sieve.SieveQueryError, /select/);
					expect(()=> sieve(users, {sort: value}), `sort=${JSON.stringify(value)}`).to.throw(sieve.SieveQueryError, /sort/);
				});
			});

		});


		describe('resource exhaustion', ()=> {

			/**
			* Build a query nested to a given depth using $and
			* @param {number} depth The number of $and levels
			* @returns {Object} The nested query
			*/
			var nest = depth => _.range(depth).reduce(q => ({$and: [q]}), {age: 22});


			it('should reject queries deeper than maxDepth', ()=> {
				expect(sieve(users, nest(5), {remapArray: false})).to.deep.equal([users[0]]);
				expect(()=> sieve(users, nest(10), {remapArray: false})).to.throw(sieve.SieveQueryError, /maxDepth/);
				expect(()=> sieve(users, nest(5), {remapArray: false, maxDepth: 4})).to.throw(sieve.SieveQueryError, /maxDepth/);
				expect(sieve(users, nest(20), {remapArray: false, maxDepth: 64})).to.deep.equal([users[0]]);
			});


			it('should quickly reject a deeply nested JSON body', ()=> {
				var body = '{"$and":['.repeat(11000) + '{}' + ']}'.repeat(11000);
				var start = Date.now();
				expect(()=> sieve(users, JSON.parse(body))).to.throw(sieve.SieveQueryError, /maxDepth/);
				expect(Date.now() - start).to.be.below(100);
			});


			it('should reject queries with more keys than maxKeys', ()=> {
				var wide = _.fromPairs(_.times(501, i => [`k${i}`, {$exists: false}]));
				expect(()=> sieve(users, wide)).to.throw(sieve.SieveQueryError, /maxKeys/);
				expect(sieve(users, wide, {maxKeys: 2000})).to.deep.equal(users);
			});


			it('should reject arrays longer than maxArrayLength', ()=> {
				var big = _.range(501);
				expect(()=> sieve(users, {age: {$in: big}})).to.throw(sieve.SieveQueryError, /maxArrayLength/);
				expect(()=> sieve(users, {age: big})).to.throw(sieve.SieveQueryError, /maxArrayLength/);
				expect(()=> sieve(users, {age: {$in: [1, 2, 3]}}, {maxArrayLength: 2})).to.throw(sieve.SieveQueryError, /maxArrayLength/);
				expect(sieve(users, {age: {$in: big}}, {maxArrayLength: 1000})).to.deep.equal(users);
			});


			it('should reject regular expressions longer than maxRegexLength', ()=> {
				expect(()=> sieve(users, {name: {$regex: 'J'.repeat(257)}})).to.throw(sieve.SieveQueryError, /maxRegexLength/);
				expect(()=> sieve(users, {name: new RegExp('J'.repeat(257))})).to.throw(sieve.SieveQueryError, /maxRegexLength/);
				expect(()=> sieve(users, {name: {$regex: 'J'.repeat(257)}}, {applyUnsafeRegex: true})).to.throw(sieve.SieveQueryError, /maxRegexLength/);
				expect(sieve(users, {name: {$regex: 'J'.repeat(257)}}, {maxRegexLength: 512})).to.deep.equal([]);
			});


			it('should reject overlapping alternation within repetition', ()=> {
				['^(a|a)*$', '(a|ab)+', '(\\w|\\d)*x', '(?:foo|fo){11,}', '((a|a)b)*', '^(x|(a|a)*)$'].forEach(pattern => {
					expect(()=> sieve(users, {name: {$regex: pattern}}), pattern).to.throw(sieve.SieveQueryError, /applyUnsafeRegex/);
				});

				var start = Date.now();
				_.attempt(()=> sieve([{name: 'a'.repeat(28) + '!'}], {name: {$regex: '^(a|a)*$'}}));
				expect(Date.now() - start).to.be.below(100);
			});


			it('should allow alternation outside of large repetition', ()=> {
				expect(sieve(users, {name: {$regex: '^(Joe|Jane)$'}})).to.deep.equal(users);
				expect(sieve(users, {name: {$regex: '^(J|j)(o|a)'}})).to.deep.equal(users);
				expect(sieve(users, {name: {$regex: '^(?:J|X){1,2}oe$'}})).to.deep.equal([users[0]]);
			});

		});


		describe('error handling', ()=> {

			it('should throw SieveQueryError with a 400 status for all bad queries', ()=> {
				[
					{$where: 'true'},
					{name: {$foo: 1}},
					{name: {$regex: 'J', $options: 'zz'}},
					{age: {$type: 'nope'}},
					{age: {$elemMatch: 'x'}},
					{name: {$regex: '('}},
					{limit: 'abc'},
					{select: {a: 1}},
				].forEach(query => {
					let err = _.attempt(()=> sieve(users, query));
					expect(err, JSON.stringify(query)).to.be.an.instanceOf(sieve.SieveQueryError);
					expect(err).to.be.an.instanceOf(Error);
					expect(err).to.include({name: 'SieveQueryError', status: 400, statusCode: 400});
				});
			});


			it('should keep the underlying Sift error as the cause', ()=> {
				let err = _.attempt(()=> sieve(users, {name: {$foo: 1}}));
				expect(err.message).to.match(/^Invalid query/);
				expect(err.cause).to.be.an.instanceOf(Error);
				expect(err.cause.message).to.match(/\$foo/);
			});


			it('should not echo large amounts of user input in error messages', ()=> {
				var long = 'x'.repeat(10000);
				[
					[{[long]: 1}, {allowFields: ['name']}],
					[{[`constructor.${long}`]: 1}],
					[{name: {[`$${long}`]: 1}}],
					[{name: {$regex: `^(a+)+${long}`}}, {maxRegexLength: 0}],
				].forEach(([query, options]) => {
					let err = _.attempt(()=> sieve(users, query, options));
					expect(err).to.be.an.instanceOf(sieve.SieveQueryError);
					expect(err.message.length).to.be.below(200);
				});
			});


			it('should not echo regular expressions in error messages', ()=> {
				let err = _.attempt(()=> sieve(users, {name: {$regex: '<script>(a+)+</script>'}}));
				expect(err).to.be.an.instanceOf(sieve.SieveQueryError);
				expect(err.message).to.not.include('<script>');
			});


			it('should throw a plain Error (not SieveQueryError) for non-array data', ()=> {
				let err = _.attempt(()=> sieve('nope', {}));
				expect(err).to.be.an.instanceOf(Error);
				expect(err).to.not.be.an.instanceOf(sieve.SieveQueryError);
			});

		});


		describe('ExpressJS req.query (qs)', ()=> {

			it('should reject operator injection via query strings', ()=> {
				expect(()=> sieve(users, parseQuery('token[$ne]=x'), {literalFields: ['token']})).to.throw(sieve.SieveQueryError);
				expect(()=> sieve(users, parseQuery('token[$regex]=^s3cr3t'), {literalFields: ['token']})).to.throw(sieve.SieveQueryError);
				expect(()=> sieve(users, parseQuery('profile.passwordHash[$regex]=^a&select=name'), {allowFields: ['name']})).to.throw(sieve.SieveQueryError);
				expect(()=> sieve(users, parseQuery('name[$where]=globalThis.__sieveCanary%3Dtrue'))).to.throw(sieve.SieveQueryError, /\$where/);
				expect(()=> sieve(users, parseQuery('$or[0][$where]=true'))).to.throw(sieve.SieveQueryError, /\$where/);
				expect(()=> sieve(users, parseQuery('name[$regex]=^(a|a)*$'))).to.throw(sieve.SieveQueryError, /applyUnsafeRegex/);
			});


			it('should not allow prototype pollution via query strings', ()=> {
				[
					'__proto__[polluted]=1',
					'constructor[prototype][polluted]=1',
					'name[__proto__][polluted]=1',
					'$or[0][__proto__][polluted]=1',
					'sort=__proto__.polluted',
					'select[__proto__]=polluted',
				].forEach(query => {
					expectSafe(()=> sieve(users, parseQuery(query)), query);
					expect({}.polluted, query).to.be.undefined;
				});

				expect(()=> sieve(users, parseQuery('constructor.name=Object'))).to.throw(sieve.SieveQueryError);
			});


			it('should reject parameter pollution of paging and projection values', ()=> {
				['limit=1&limit=2', 'limit[$gt]=0', 'limit[]=1', 'skip=1&skip=0', 'select[a]=1', 'select[0][a]=1', 'sort[name]=1'].forEach(query => {
					expect(()=> sieve(users, parseQuery(query)), query).to.throw(sieve.SieveQueryError);
				});

				expect(sieve(users, parseQuery('limit=1&skip=1'))).to.deep.equal([users[1]]);
				expect(sieve(users, parseQuery('sort=-age'))).to.deep.equal([users[1], users[0]]);
				expect(sieve(users, parseQuery('select=name&select=age'))).to.deep.equal(users.map(u => _.pick(u, ['name', 'age'])));
			});


			it('should treat repeated filter keys as $in', ()=> {
				expect(sieve(users, parseQuery('name=Joe&name=Jane'))).to.deep.equal(users);
				expect(sieve(users, parseQuery('name=Joe&name=Nobody'))).to.deep.equal([users[0]]);
			});


			it('should treat query string values as strings', ()=> {
				expect(sieve(users, parseQuery('age=22'))).to.deep.equal([]);
				expect(sieve(users, parseQuery('name[$in][]=Joe&name[$in][]=Bob'))).to.deep.equal([users[0]]);
			});


			it('should safely handle qs sparse-array and deep-nesting quirks', ()=> {
				[
					'name[999]=Joe',
					'name[$in][999]=Joe',
					'$or[999][name]=Joe',
					'$and[0][$or][0][$nor][0][name]=Joe',
					'tags[$elemMatch][label][$regex]=adm',
					'age[$size]=abc',
					'age[$mod]=x',
					'age[$all][$in]=1',
					'name[$exists]=false',
					'name[]=',
					'=x',
					'%24where=1',
					'name[$regex]=J&name[$options]=gimsuy',
				].forEach(query => expectSafe(()=> sieve(users, parseQuery(query)), query));

				var deep = 'a' + '[$and][0]'.repeat(40) + '[name]=Joe';
				expect(()=> sieve(users, parseQuery(deep, {depth: Infinity}))).to.throw(sieve.SieveQueryError, /maxDepth/);
			});

		});


		describe('fuzzing', ()=> {

			/**
			* Seeded PRNG (mulberry32) so fuzz runs are reproducible
			* @param {number} seed The seed value
			* @returns {Function} Function returning a pseudo-random number between 0 and 1
			*/
			var prng = seed => ()=> {
				seed = (seed + 0x6D2B79F5) | 0;
				let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};

			var keys = ['name', 'age', 'token', 'tags', 'profile.city', '__proto__', 'constructor', 'a.b', '', '$and', '$or', '$nor', '$not', '$where', '$regex', '$options', '$in', '$nin', '$all', '$elemMatch', '$exists', '$gt', '$ne', '$size', '$mod', '$type', '$eq', '$foo', 'limit', 'skip', 'sort', 'select', '0', '999'];
			var scalars = ['', 'Joe', '22', 22, -1, 0, 1.5, null, true, false, 'false', '^(a+)+$', '(a|a)*', '(', 'globalThis.__sieveCanary = true', 'constructor', '__proto__', 'J'.repeat(300), 'gimsuy', 'zz', 'string', 'number'];


			/**
			* Generate a random query-like value
			* @param {Function} rand The PRNG
			* @param {number} depth The remaining depth
			* @returns {*} A random scalar, array or object
			*/
			var generate = (rand, depth) => {
				let pick = list => list[Math.floor(rand() * list.length)];
				let roll = rand();
				return depth <= 0 || roll < 0.4 ? pick(scalars)
					: roll < 0.6 ? _.times(Math.floor(rand() * 4), ()=> generate(rand, depth - 1))
					: _.fromPairs(_.times(1 + Math.floor(rand() * 3), ()=> [pick(keys), generate(rand, depth - 1)]));
			};


			it('should only ever throw SieveQueryError for random hostile queries', ()=> {
				let rand = prng(1337);
				_.times(5000, i => {
					let query = _.fromPairs(_.times(1 + Math.floor(rand() * 3), ()=> [keys[Math.floor(rand() * keys.length)], generate(rand, 5)]));
					globalThis.__sieveCanary = false;
					expectSafe(()=> sieve(users, query), `#${i} ${JSON.stringify(query)}`);
					expectSafe(()=> sieve(users, query, {allowFields: ['name', 'age'], literalFields: ['token'], maxLimit: 1}), `#${i} restricted ${JSON.stringify(query)}`);
					expect(globalThis.__sieveCanary, `#${i} ${JSON.stringify(query)}`).to.be.false;
					expect({}.polluted).to.be.undefined;
				});
				delete globalThis.__sieveCanary;
			});

		});

	});

});
