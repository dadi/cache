'use strict'

const fs = require('fs')
const path = require('path')
const should = require('should')
const redis = require('ioredis')
const toString = require('stream-to-string')

const Cache = require(__dirname + '/../../lib/index')
const RedisCache = require(__dirname + '/../../lib/redis')

var cache

describe('RedisCache', function () {
  describe('Non-clustered instance (127.0.0.1:6379)', () => {
    const redisConfig = {
      enabled: true,
      cluster: false,
      host: '127.0.0.1',
      port: 6379
    }

    afterEach((done) => {
      cache = null
      done()
    })

    it('should connect to redis', (done) => {
      cache = Cache({ directory: { enabled: false }, redis: redisConfig })
      cache.cacheHandler.on('ready', () => {
        done()
      })
    })

    it('should read and write to redis', (done) => {
      cache = Cache({ directory: { enabled: false }, redis: redisConfig })
      cache.cacheHandler.on('ready', () => {
        cache.set('foo', 'bar').then(() => {
          cache.get('foo').then((stream) => {
            toString(stream, (err, data) => {
              data.should.eql('bar')
              done()
            })
          }).catch((err) => {
            console.log('get err', err)
          })
        }).catch((err) => {
          console.log('set err', err)
        })
      })
    })

    it('should flush the cache', (done) => {
      cache = Cache({ directory: { enabled: false }, redis: redisConfig })
      cache.cacheHandler.on('ready', () => {
        cache.set('foo', 'bar').then(() => {
          cache.flush().then(() => {
            cache.get('foo')
              .then(() => {})
              .catch((err) => {
                (err instanceof Error).should.equal(true)
                err.message.should.eql('The specified key does not exist')
                done()
              })
          }).catch((err) => {
            console.log('flush err', err)
          })
        }).catch((err) => {
          console.log('set err', err)
        })
      })
    })
  })

  describe('Non-clustered instance (127.0.0.1:6379)', () => {
    it.skip('should connect to a redis cluster', (done) => {
      cache = Cache({
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

    it.skip('should write and read from a redis cluster', (done) => {
      cache = Cache({
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
})
