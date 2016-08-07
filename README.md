# DADI Cache

[![npm (scoped)](https://img.shields.io/npm/v/@dadi/cache.svg?maxAge=10800&style=flat-square)](https://www.npmjs.com/package/@dadi/cache)&nbsp;[![coverage](https://img.shields.io/badge/coverage-85%25-yellow.svg?style=flat-square)](https://github.com/dadi/cache)&nbsp;[![Build](http://ci.dadi.technology/dadi/cache/badge?branch=master&service=shield)](http://ci.dadi.technology/dadi/cache)

## Overview

Removing the complexity involved in setting up two separate cache handlers for every project, DADI Cache can use either the filesystem or a Redis instance to store and retrieve content.

## Install

```shell
npm install @dadi/cache --save
```

## Usage

### Configuraton options

#### File caching

Property|Description|Default|Example
--------|-----------|-------|-------
enabled|If true, caching is enabled using the following settings|true|
path|The absolute or relative path to the directory for cache files|"./cache"|"/tmp/dadi-cache/"
extension| (optional) The extension to use for cache files| none | "json"
directoryChunkSize| (optional) If set, cache files are stored in a series of subdirectories based on the cache key| 0 | 5

#### Redis caching

A set of options for both file and Redis caching must be provided if you intend to use Redis as the cache store. This allows DADI Cache
to [fallback to file caching](#fallback) in the event of a Redis connection failure.

Property|Description|Default|Example
--------|-----------|-------|-------
enabled|If true, caching is enabled using the following settings|false|true
host|The hostname or IP address of the Redis server |"127.0.0.1"|"drum.redistogo.com"
port|The port of the Redis server|6379 |9092

#### Default options

A DADI Cache instance can be created with no options, in which case the following options will be used:

```js
{
  "directory": {
    "enabled": true,
    "path": "./cache"
  },
  "redis": {
    "enabled": false
  }
}
```

### Fallback

In the case of a Redis connection failure, DADI Cache will attempt to reconnect four times before switching to file caching.
After a configurable period (default 5 minutes), an attempt will be made to reconnect to Redis and if successful DADI Cache will resume
using Redis as the cache store.


### Create Cache instance

```js
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
var key = 'test-cached-item'

cache.get(key).then((stream) => {
  // do something with the stream
}).catch((err) => {
  // "The specified key does not exist"
})
```

### Example usage

```js
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

    // cache the content
    cache.set(req.url, content).then(() => {
      res.setHeader('X-Cache', 'MISS')
      res.end(content)
    })
  })
})
```

### Roadmap

* Switch to [ioredis](https://github.com/luin/ioredis) package for Redis
* Add LATENCY HISTORY to assist in determining Redis performance
* Add FLUSH
* Add authentication options for Redis