var fs = require('fs')
var path = require('path')
var should = require('should')
var sinon = require('sinon')
var Stream = require('stream')
var Cache = require(__dirname + '/../../lib/index')
var FileCache = require(__dirname + '/../../lib/file')

describe('FileCache', function () {
  it('should use empty string extension if none is specfied', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
    var handler = cache.cacheHandler
    return handler.extension.should.eql('')
  })

  it('should use extension if one is specfied', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache', extension: 'json' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
    var handler = cache.cacheHandler
    return handler.extension.should.eql('.json')
  })

  describe('set', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache', extension: 'json' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

    afterEach(function () {
      var files = fs.readdirSync(cache.cacheHandler.directory)
      files.forEach((file) => {
        fs.unlinkSync(cache.cacheHandler.directory + '/' + file)
      })
    })

    it('should generate a cache filename from the directory and key', sinon.test(function() {
      var spy = this.spy(fs, 'createWriteStream')
      cache.set('key1', 'data')

      return spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
    }))

    it('should create a cache file when a String is passed', function(done) {
      cache.set('key1', 'data')

      // check a file exists
      fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
        (!err).should.eql(true)
        done()
      })
    })

    it('should create a cache file when a Buffer is passed', function(done) {
      var buffer = new Buffer('data')
      cache.set('key1', buffer)

      // check a file exists
      fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
        (!err).should.eql(true)
        done()
      })
    })

    it('should create a cache file when a Stream is passed', function(done) {
      var stream = new Stream.Readable
      stream.push('data')
      stream.push(null)
      cache.set('key1', stream)

      // check a file exists
      fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
        (!err).should.eql(true)
        done()
      })
    })
  })

  describe('get', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache', extension: 'json' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

    afterEach(function () {
      var files = fs.readdirSync(cache.cacheHandler.directory)
      files.forEach((file) => {
        fs.unlinkSync(cache.cacheHandler.directory + '/' + file)
      })
    })

    it('should generate a cache filename from the directory and key', sinon.test(function() {
      var spy = this.spy(fs, 'stat')

      cache.set('key1', 'data')
      cache.get('key1')

      return spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
    }))

    it('should reject if the key cannot be found', function(done) {
      cache.set('key1', 'data')
      cache.get('key2').then((stream) => {

      }).catch((err) => {
        err.message.should.eql('The specified key does not exist')
        done()
      })
    })

    it('should reject if the key has expired')

    it('should return a stream', function(done) {
      cache.set('key1', 'data')
      cache.get('key1').then((stream) => {
        stream.should.exist
        done()
      })
    })
  })
})