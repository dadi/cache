const _ = require('underscore')
const fs = require('fs')
const path = require('path')
const should = require('should')
const redis = require('ioredis')
const toString = require('stream-to-string')

const Cache = require(__dirname + '/../../lib/index')
const RedisCache = require(__dirname + '/../../lib/redis')

var cache

describe('RedisCache', function () {
  // this.timeout(10000)

  it('should connect to a redis non-clustered instance (127.0.0.1:6379)', (done) => {
    cache = new Cache({
      directory: {
        enabled: false
      },
      redis: {
        enabled: true,
        cluster: false,
        host: '127.0.0.1',
        port: 6379
      }
    })

    cache.cacheHandler.on('ready', () => {
      done()
    })
  })

  it('should connect to a redis cluster (127.0.0.1:7000-7002)', (done) => {
    cache = new Cache({
      directory: {
        enabled: false
      },
      redis: {
        enabled: true,
        cluster: true,
        hosts: [
          { host: '127.0.0.1', port: 7000 },
          { host: '127.0.0.1', port: 7001 },
          { host: '127.0.0.1', port: 7002 }
        ]
      }
    })

    cache.cacheHandler.on('ready', () => {
      done()
    })
  })

  it('should write and read from a redis cluster (127.0.0.1:7000-7002)', (done) => {
    cache = new Cache({
      directory: {
        enabled: false
      },
      redis: {
        enabled: true,
        cluster: true,
        hosts: [
          { host: '127.0.0.1', port: 7000 },
          { host: '127.0.0.1', port: 7001 },
          { host: '127.0.0.1', port: 7002 }
        ]
      }
    })

    cache.cacheHandler.on('ready', () => {
      cache.set('foo', 'bar')
      cache.get('foo').then((stream) => {
        toString(stream, (err, data) => {
          data.should.eql('bar')
          done()
        })
      }).catch((err) => {
        console.log(err)
      })
    })
  })

})
