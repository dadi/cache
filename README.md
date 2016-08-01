# DADI Cache

[![npm (scoped)](https://img.shields.io/npm/v/@dadi/cache.svg?maxAge=10800&style=flat-square)](https://www.npmjs.com/package/@dadi/cache)&nbsp;[![coverage](https://img.shields.io/badge/coverage-77%25-yellow.svg?style=flat-square)](https://github.com/dadi/cache)&nbsp;[![Build](http://ci.dadi.technology/dadi/cache/badge?branch=master&service=shield)](http://ci.dadi.technology/dadi/cache)

## Overview


## Install

```shell
npm install @dadi/cache --save
```

## Usage

### Create Cache instance

```js
{@lang javascript}
// require the module
var Cache = require('@dadi/cache')

// setup the options for caching
// default if not specified: { directory: { enabled: true, path: './cache' }, redis: { enabled: false } }
var options = {
  "ttl": 3600,
  "directory": {
    "enabled": false,
    "path": "./cache/"
  },
  "redis": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 6379
  }
}

var cache = new Cache(options)
```

### Add an item to the cache

#### `set(key, data)`

Returns a Promise that returns an empty String if successful, otherwise an Error.

The `data` argument can be a String, Buffer or Stream.

```js
{@lang javascript}
var key = 'test-cached-item'
var data = 'test data'

cache.set(key, data).then(() => {
  // do something
}).catch((err) => {
  // Error
})
```

### Get an item from the cache

#### `get(key)`

Returns a Promise that returns a Stream of the cached data if the key exists or an Error if it does not exist.
The error message returned is "The specified key does not exist".

```js
{@lang javascript}
var key = 'test-cached-item'

cache.get(key).then((stream) => {
  // do something with the stream
}).catch((err) => {
  // "The specified key does not exist"
})
```

### Example usage

```js
{@lang javascript}
var Cache = require('@dadi/cache')
var cache = new Cache()

app.use(function (req, res, next) {
  cache.get(req.url).then((stream) => {
    // cached data found for req.url
    res.setHeader('X-Cache', 'HIT')
    stream.pipe(res)
  }).catch((err) => {
    // cached data not found for req.url
    var content = fetchContent()

    res.setHeader('X-Cache', 'MISS')
    res.end(content)
  })
})
```