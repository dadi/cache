# DADI Cache

[![npm (scoped)](https://img.shields.io/npm/v/@dadi/cache.svg?maxAge=10800&style=flat-square)](https://www.npmjs.com/package/@dadi/cache)
[![coverage](https://img.shields.io/badge/coverage-82%25-yellow.svg?style=flat-square)](https://github.com/dadi/cache)
[![Build Status](https://travis-ci.org/dadi/cache.svg?branch=master)](https://travis-ci.org/dadi/cache)
[![JavaScript Style Guide](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](http://standardjs.com/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg?style=flat-square)](https://github.com/semantic-release/semantic-release)

> A caching layer supporting Redis and filesystem caching, used in core DADI products

* [Overview](#overview)
* [Install](#install)
* [Usage](#usage)
  * [Create Cache instance](#create-cache-instance)
  * [Add an item to the cache](#add-an-item-to-the-cache)
  * [Get an item from the cache](#get-an-item-from-the-cache)
  * [Example real world usage](#example-real-world-usage)
* [Configuration](#configuration)
  * [General Options](#general-options)
  * [Default Options](#default-options)
  * [Filesystem Caching](#filesystem-caching)
  * [Redis Caching](#redis-caching)
  * [Redis Cluster](#redis-cluster)
* [Cache Fallback](#cache-fallback)

## Overview

Removing the complexity involved in setting up two separate cache handlers for every project, DADI Cache can use either the filesystem or a Redis instance to store and retrieve content.

## Install

```shell
npm install @dadi/cache --save
```

## Usage

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

### Example real world usage

```js
var express = require('express')
var app = express()
var dadiCache = require('@dadi/cache')
var cache = new dadiCache()

app.get(function (req, res) {
  var key = req.url

  cache.get(key).then((stream) => {
    // cached data found for req.url
    res.setHeader('X-Cache', 'HIT')
    stream.pipe(res)
  }).catch((err) => {
    // cached data not found for req.url
    var content = fetchContent()

    // cache the content
    cache.set(key, content).then(() => {
      res.setHeader('X-Cache', 'MISS')
      res.end(content)
    })
  })
})
```

## Configuraton

### General options

Property|Description|Default|Example
--------|-----------|-------|-------
ttl|The time, in seconds, after which cached data is considered stale|true|3600

### Default options

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

### Filesystem caching

Property|Description|Default|Example
--------|-----------|-------|-------
enabled|If true, caching is enabled using the following settings|true|
path|The absolute or relative path to the directory for cache files|"./cache"|"/tmp/dadi-cache/"
extension| (optional) The extension to use for cache files| none | "json"
directoryChunkSize| (optional) If set, cache files are stored in a series of subdirectories based on the cache key| 0 | 5
autoFlush | If true, DADI Cache will clear cache files that are older than the specified TTL setting, at the interval specified by `autoFlushInterval` | false | true
autoFlushInterval | The period of time between clearing cache files (in seconds) | 300 | 1800

### Redis caching

A set of options for both file and Redis caching _must_ be provided if you intend to use Redis as the cache store. This allows DADI Cache
to [fallback to file caching](#cache-fallback) in the event of a Redis connection failure.

Property|Description|Default|Example
--------|-----------|-------|-------
enabled|If true, caching is enabled using the following settings|false|true
host|The hostname or IP address of the Redis server |"127.0.0.1"|"drum.redistogo.com"
port|The port of the Redis server|6379 |9092

```json
{
  "directory": {
    "enabled": true,
    "path": "./cache"
  },
  "redis": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 6379
  }
}
```

### Redis Cluster

Property|Description|Default|Example
--------|-----------|-------|-------
enabled|If true, caching is enabled using the following settings|false|true
cluster|If true, DADI Cache will connect caching is enabled using the following settings|false|true
scaleReads|Specify where to send queries, to the masters, slaves, or a combination. See [Read-Write Splitting](#read-write-splitting) |"master"|"all"
hosts|When `cluster: true`, Cache uses this array of hosts to connect. Each array item must contain a `host` and `port`.|| ```[{"host":"127.0.0.1", "port": 6379}, {"host":"127.0.0.1", "port": 6380}]```

To connect to a Redis cluster an array of hosts must be specified, rather than a single host and port.

> The array does not need to contain all your cluster nodes, but a few so that if one is unreachable the next one will be tried. DADI Cache will discover other nodes automatically when at least one node is connnected.

```json
{
  "directory": {
    "enabled": true,
    "path": "./cache"
  },
  "redis": {
    "enabled": true,
    "cluster": true,
    "scaleReads": "all",
    "hosts": [
      {
        "host": "127.0.0.1",
        "port": 6379
      },
      {
        "host": "127.0.0.1",
        "port": 6383
      }
    ]
  }
}
```

#### Read-Write Splitting

A typical Redis cluster contains three or more masters and several slaves for each master. It's possible to scale out Redis cluster by sending read queries to slaves and write queries to masters by setting the `scaleReads` option.

`scaleReads` is "master" by default, which means no queries will be sent to slaves. The other available options:

* "all": Send write queries to masters and read queries to masters or slaves randomly.
* "slave": Send write queries to masters and read queries to slaves.

**For example, with `scaleReads: "slave"`:**

```js
cache.set('foo', 'bar') // This query will be sent to one of the masters.
cache.get('foo', function (err, res) {
  // This query will be sent to one of the slaves.
})
```

**Note:** In the code snippet above, the result may not be equal to "bar" because of the lag of replication between the master and slaves.

## Cache Fallback

In the case of a Redis connection failure, DADI Cache will attempt to reconnect four times before switching to file caching.
After a configurable period (default 5 minutes), an attempt will be made to reconnect to Redis and if successful DADI Cache will resume
using Redis as the cache store.

## Roadmap

* Add LATENCY HISTORY to assist in determining Redis performance
* Add FLUSH
* Add authentication options for Redis
