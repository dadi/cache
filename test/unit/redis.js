const _ = require('underscore')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const should = require('should')
const redis = require('ioredis')
const Stream = require('stream')
const toString = require('stream-to-string')
const RedisMock = require('ioredis-mock').default
const exec = require('child_process').exec
const EventEmitter = require('events').EventEmitter

const Cache = require(__dirname + '/../../lib/index')
const RedisCache = require(__dirname + '/../../lib/redis')

/* RedisMock is not complete, so must create some stubs */
RedisMock.prototype.on = () => {}
RedisMock.prototype.getrange = () => {}
RedisMock.prototype.expire = () => {}
RedisMock.prototype.status = 'ready'

var cache

describe('RedisCache', () => {

  describe('set', () => {

    after((done) => {
      // remove cache folder contents completely, and recreate
      const cleanup = (dir) => {
        exec('rm -r ' + dir, (err, stdout, stderr) => {
          exec('mkdir ' + dir)
          done()
        })
      }

      if (cache.cacheHandler.directory) {
        cleanup(path.resolve(cache.cacheHandler.directory))
      } else {
        done()
      }
    })

    it('should fallback to file cache when `set` is called and Redis is not connected', function(done) {
      // new cache with incorrect configuration
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6378 } })
      cache.set('key1', 'data')

      // check a file exists
      fs.stat(path.resolve(path.join(cache.cacheHandler.directory, 'key1.json')), (err, stats) => {
        should.exist(stats)
        done()
      })
    })

    it('should add to Redis cache when a String is passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(redis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data')

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-string').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache when a Buffer is passed', sinon.test(function(done) {
      const client = new RedisMock()
      this.stub(redis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-buffer', new Buffer('data'))

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-buffer').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache when a Stream is passed', sinon.test(function(done) {
      const client = new RedisMock()
      this.stub(redis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      const stream = new Stream.Readable
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
      const client = new RedisMock()
      this.stub(client, 'exists').yields(null, 0)
      this.stub(redis, 'createClient').returns(client)

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      return cache.get('key1').then(() => {}).catch((err) => {
        err.message.should.eql('The specified key does not exist')
      })
    }))

    it('should return a stream', sinon.test(function(done) {
      const stream = new Stream.Readable
      stream.push('data')
      stream.push(null)

      const client = new RedisMock()
      this.stub(client, 'exists').yields(null, 1)

      const getRange = this.stub(client, 'getrange')
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

  describe('EventEmitter', function(){
    describe('#emit()', function(){
      it('should invoke the callback', function(){
        const spy = sinon.spy();
        const emitter = new EventEmitter;

        emitter.on('foo', spy);
        emitter.emit('foo');
        spy.called.should.equal.true;
      })

      it('should pass arguments to the callbacks', function(){
        const spy = sinon.spy();
        const emitter = new EventEmitter;

        emitter.on('foo', spy);
        emitter.emit('foo', 'bar', 'baz');
        sinon.assert.calledOnce(spy);
        sinon.assert.calledWith(spy, 'bar', 'baz');
      })
    })
  })
})
