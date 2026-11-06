var _ = require('lodash');
var expect = require('chai').expect;
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
			sieve(data, JSON.parse('{"__proto__": {"polluted": true}}'));
			sieve(data, JSON.parse('{"constructor": {"prototype": {"polluted": true}}}'));
			sieve(data, JSON.parse('{"$or": [{"__proto__": {"polluted": true}}]}'), {remapArray: false});
			expect({}.polluted).to.be.undefined;
		});


		it('should not allow prototype pollution via select / sort', ()=> {
			sieve(data, {select: ['__proto__.polluted', 'constructor.prototype.polluted']});
			sieve(data, {select: '__proto__,constructor,prototype'});
			sieve(data, {select: '!__proto__,!constructor.prototype'});
			sieve(data, {sort: '__proto__.polluted,-constructor.prototype'});
			expect({}.polluted).to.be.undefined;
			expect(sieve(data, {select: '__proto__'})).to.deep.equal(data.map(()=> ({})));
			expect(sieve(data, {select: 'constructor'})).to.deep.equal(data.map(()=> ({})));
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

});
