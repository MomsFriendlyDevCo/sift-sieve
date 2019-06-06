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
		expect(()=> sieve(data, {select: ['!name', 'age']})).to.throw;
	});

});
