var fakeredis = require('fakeredis')
var fs = require('fs')
var path = require('path')
var redis = require('redis')
var MockRedisClient = require('mock-redis-client')
var should = require('should')
var sinon = require('sinon')
var Stream = require('stream')
var toString = require('stream-to-string')
var _ = require('underscore')

var Cache = require(__dirname + '/../../lib/index')
var RedisCache = require(__dirname + '/../../lib/redis')

var cache

describe('RedisCache', function () {

  describe('set', function () {

    afterEach(function () {
      if (cache.cacheHandler.directory) {
        var files = fs.readdirSync(cache.cacheHandler.directory)
        files.forEach((file) => {
          fs.unlinkSync(cache.cacheHandler.directory + '/' + file)
        })
      }
    })

    it('should fallback to file cache when `set` is called and Redis is not connected', function(done) {
      // new cache with incorrect configuration
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6378 } })
      cache.set('key1', 'data')

      // check a file exists
      setTimeout(function() {
        fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
          (!err).should.eql(true)
          done()
        })
      }, 500)
    })

    it('should add to Redis cache when a String is passed', sinon.test(function(done) {
      var client = fakeredis.createClient()
      this.stub(redis, 'createClient').returns(client)
      var spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data')

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-string').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache when a Buffer is passed', sinon.test(function(done) {
      var client = fakeredis.createClient()
      this.stub(redis, 'createClient').returns(client)
      var spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-buffer', new Buffer('data'))

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-buffer').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache when a Stream is passed', sinon.test(function(done) {
      var client = fakeredis.createClient()
      this.stub(redis, 'createClient').returns(client)
      var spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      var stream = new Stream.Readable
      stream.push('data')
      stream.push(null)
      cache.set('key-stream', stream)

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-stream').should.be.above(-1)
      done()
    }))
  })

  describe('get', function () {

    afterEach(function () {
    })

    it('should fallback to file cache when `get` is called and Redis is not connected', sinon.test(function() {
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6378 } })
      return cache.get('key2').then((stream) => {

      }).catch((err) => {
        err.message.should.eql('The specified key does not exist')
        cache.cacheHandler.constructor.name.should.eql('FileCache')
      })
    }))

    it('should reject if the key cannot be found', sinon.test(function() {
      var client = fakeredis.createClient()
      this.stub(client, 'exists').yields(null, 0)
      this.stub(redis, 'createClient').returns(client)

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      return cache.get('key1').then(() => {}).catch((err) => {
        err.message.should.eql('The specified key does not exist')
      })
    }))

    it('should return a stream', sinon.test(function(done) {
      var stream = new Stream.Readable
      stream.push('data')
      stream.push(null)

      var client = fakeredis.createClient()
      this.stub(client, 'exists').yields(null, 1)
      var getRange = this.stub(client, 'getrange')
      getRange.withArgs(new Buffer('key1'), 0, 16383).yields(null, new Buffer('data'))
      getRange.withArgs(new Buffer('key1'), 16384, 32767).yields(null, new Buffer(''))

      this.stub(redis, 'createClient').returns(client)

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.get('key1').then((stream) => {
        toString(stream, function (err, data) {
          data.should.eql('data')
          done()
        })
      }).catch((err) => {
        console.log(err)
      })
    }))
  })
})