var path = require('path')
var should = require('should')
var sinon = require('sinon')
var Stream = require('stream')
var Cache = require(__dirname + '/../../lib/index')
var RedisCache = require(__dirname + '/../../lib/redis')

describe('RedisCache', function () {

  describe('set', function () {
    var cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

    afterEach(function () {
    })

    it('should create a cache file when a String is passed', function(done) {
      cache.set('key-string', 'data')

      done()
    })

    it('should create a cache file when a Buffer is passed', function(done) {
      var buffer = new Buffer('data')
      cache.set('key-buffer', buffer)

      done()
    })

    it('should create a cache file when a Stream is passed', function(done) {
      var stream = new Stream.Readable
      stream.push('data')
      stream.push(null)
      cache.set('key-stream', stream)

      done()
    })
  })

  describe('get', function () {
    var cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

    afterEach(function () {
    })

    it('should reject if the key cannot be found', function(done) {
      cache.set('key1', 'data')
      cache.get('key2').then((stream) => {

      }).catch((err) => {
        err.message.should.eql('The specified key does not exist')
        done()
      })
    })

    it('should return a stream', function(done) {
      cache.set('key1', 'data')
      cache.get('key1').then((stream) => {
        stream.should.exist
        done()
      })
    })
  })
})