@MomsFriendlyDevCo/Sift-Sieve
=============================
Wrapper around [Sift](https://github.com/crcn/sift.js) which provides other ReST functionality.

This project extends the existing Sift syntax to include support for `limit`, `skip`, `sort` and `select`, which are common meta keys in most ReST endpoints.

```javascript
var sieve = require('@momsfriendlydevco/sift-sieve');

var data = [
	{name: 'Joe Random', age: 22, email: 'joe@mfdc.biz'},
	{name: 'Jane Random', age: 25, email: 'jane@mfdc.biz'},
	{name: 'Nora Clarke', age: 35, email: 'norah@gmail.com'},
	{name: 'Michael Chaos', age: 35, email: 'michael@gmail.com'},
];

sieve(data, {name: 'Joe Random'}); //= Just the "Joe Random" person as an array, exactly like sift
sieve(data, {age: {$gt: 25}}); //= Everyone over the age of 25
sieve(data, {age: {$gt: 25}, limit: 1}); //= Only the first person over 25
sieve(data, {age: {$gt: 25}, sort: 'age'}); //= Everyone over the age of 25 sorted by youngest to oldest
sieve(data, {age: {$gt: 25}, sort: '-age,name'}); //= Everyone over the age of 25 sorted by oldtest to youngest and name
sieve(data, {age: {$gt: 25}, skip: 1, limit: 1}); //= The second person over 25
sieve(data, {age: {$gt: 25}, skip: 1, limit: 1, select: 'name'}); //= ...Just their name
```

See the [testkits](./test) for more complex examples.


API
===
This module returns a single function which takes the data to filter, the query criteria and settings.


sieve(data, query, options)
---------------------------
Data is always an array. Query is an (optional) object in Sift / Mongo query format, options is an optional object of options.

Options are passed directly to Sift with the following exceptions:

| Option       | Type      | Default | Description                                                                            |
|--------------|-----------|---------|----------------------------------------------------------------------------------------|
| `remapArray` | `boolean` | `true`  | Whether to transform simple `{key: Array}` keys into `{key: {$in: Array}}`             |
| `count`      | `boolean` | `false` | Whether to return a single Number of the matching elements rather than the found items |
