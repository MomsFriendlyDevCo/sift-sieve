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
| `applyWhere` | `boolean` | `false` | Whether to allow `$where` conditions and function values (at any depth) - unless exactly `true` any query containing either throws an error |
| `applyUnsafeRegex` | `boolean` | `false` | Whether to allow regular expressions prone to catastrophic backtracking (ReDoS), detected via [safe-regex2](https://github.com/fastify/safe-regex2) plus a check for alternation inside large repetitions such as `(a\|a)*` - unless exactly `true` any query containing one throws an error |
| `allowFields` | `Array<string>` | `null` | If set, only these (dotted) field paths and their sub-paths may be filtered or sorted on. Containers of allowed fields may be queried via `$elemMatch`. Does not restrict `select` |
| `literalFields` | `Array<string>` | `[]` | Field paths which only accept literal values (strings, numbers, booleans, null or arrays of these) - operators, objects and RegExps are rejected, as are sub-paths of these fields |
| `maxLimit` | `number` | `0` | If set, the maximum number of results returned, also applied when no `limit` is given. Not applied when `count` is set |
| `maxDepth` | `number` | `16` | Maximum nesting depth of the query, `0` to disable |
| `maxKeys` | `number` | `500` | Maximum total number of object keys within the query, `0` to disable |
| `maxArrayLength` | `number` | `500` | Maximum length of any array within the query, `0` to disable |
| `maxRegexLength` | `number` | `256` | Maximum length of any regular expression source, applied even if `applyUnsafeRegex` is set, `0` to disable |

Queries must be plain objects (or empty), any other type throws an error.

The following are also validated:

* `limit` / `skip` must be non-negative integers or numeric strings
* `select` / `sort` must be strings (CSV) or arrays of strings
* Field paths may never contain the `__proto__`, `constructor` or `prototype` segments

Note that `limit` / `skip` are applied before `sort`.


Errors
------
Any invalid, unsafe or disallowed query throws a `SieveQueryError` (exported as `sieve.SieveQueryError`) which has `status` and `statusCode` set to `400` so it can be handed directly to an ExpressJS style error handler. Error messages only ever contain truncated user input and the underlying error (if any) is available as `err.cause`.


Security
--------
When feeding user input such as `req.query` or `req.body` directly into sieve:

* **Always** set `allowFields` - otherwise any field can be filtered on, letting an attacker infer hidden values (e.g. `?passwordHash[$regex]=^a` with the result count acting as an oracle) even if the field is removed via `select`
* Set `literalFields` for any field used for lookups or authentication (e.g. tokens) - otherwise `?token[$ne]=x` matches every record
* Set `maxLimit` to stop bulk extraction
* Query string values are always strings, `?age=22` will not match the number `22`
* Repeated keys (`?name=a&name=b`) become arrays which are remapped to `$in` unless `remapArray` is disabled
