const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const should = require('should')
const redis = require('ioredis')
const noderedis = require('redis')
const Stream = require('stream')
const toString = require('stream-to-string')
const RedisMock = require('ioredis-mock').default
const exec = require('child_process').exec
const EventEmitter = require('events').EventEmitter

const Cache = require(__dirname + '/../../lib/index')
const RedisCache = require(__dirname + '/../../lib/redis')

/* RedisMock is not complete, so must create some stubs */
RedisMock.prototype.on = () => {}
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

    it('should add to Redis cache when a String is passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data')

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-string').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache and save metadata when a String and options.metadata are passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      let metadata = {
        foo: 'bar',
        baz: 123
      }

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data', { metadata }).then(() => {
        spy.called.should.eql(true)
        spy.firstCall.args[0].indexOf('key-string').should.be.above(-1)
        spy.secondCall.args[0].should.eql('___key-string___')
        spy.secondCall.args[1].should.eql(JSON.stringify(metadata))

        done()
      })
    }))

    it('should add to Redis cache when a Buffer is passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-buffer', new Buffer('data'))

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-buffer').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache and save metadata when a Buffer and options.metadata are passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      let metadata = {
        foo: 'bar',
        baz: 123
      }

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-buffer', new Buffer('data'), { metadata }).then(() => {
        // check params passed to SET
        spy.called.should.eql(true)
        spy.firstCall.args[0].indexOf('key-buffer').should.be.above(-1)

        spy.secondCall.args[0].should.eql('___key-buffer___')
        spy.secondCall.args[1].should.eql(JSON.stringify(metadata))

        done()        
      })
    }))

    it('should add to Redis cache when a Stream is passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      const stream = new Stream.Readable()
      stream.push('data')
      stream.push(null)
      cache.set('key-stream', stream)

      // check params passed to SET
      spy.called.should.eql(true)
      spy.firstCall.args[0].indexOf('key-stream').should.be.above(-1)
      done()
    }))

    it('should add to Redis cache and save metadata when a Stream and options.metadata are passed', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      let metadata = {
        foo: 'bar',
        baz: 123
      }

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      const stream = new Stream.Readable()
      stream.push('data')
      stream.push(null)
      cache.set('key-stream', stream, { metadata }).then(() => {
        // check params passed to SET
        spy.called.should.eql(true)
        spy.firstCall.args[0].indexOf('key-stream').should.be.above(-1)

        spy.secondCall.args[0].should.eql('___key-stream___')
        spy.secondCall.args[1].should.eql(JSON.stringify(metadata))

        done()
      })
    }))

    it('should set and return binary data', sinon.test(function (done) {
      this.timeout(5000)
      // const client = new RedisMock()
      // this.stub(redis, 'createClient').returns(client)
      // const spy = this.spy(client, 'set')
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      var concat = require('concat-stream')
      var lengthStream = require('length-stream')
      var inputLength = 0
      var outputLength = 0

      function lengthListener (length) {
        inputLength = length
      }

      function lengthListener2 (length) {
        outputLength = length
      }

      function handleBuffer1 (buffer) { }
      function handleBuffer2 (buffer) {
        console.log(inputLength)
        console.log(outputLength)
        // fs.createWriteStream(__dirname + '/../cat2.png')
        done()
      }

      var P = require('stream').PassThrough
      var inputStream = new P()
      var concatStream1 = concat(handleBuffer1)
      var catStream = fs.createReadStream(__dirname + '/../cat.png', { encoding: null })
      catStream.pipe(lengthStream(lengthListener)).pipe(concatStream1)

      cache.on('ready', () => {
        cache.set('cat-stream', catStream).then(() => {
          cache.get('cat-stream').then((outStream) => {
            var concatStream2 = concat(handleBuffer2)
            var out = fs.createWriteStream(__dirname + '/../cat2.png')
            outStream.pipe(lengthStream(lengthListener2)).pipe(out)
            done()
          })
        })
      })
    }))

    it.skip('should fallback to file cache when `set` is called and Redis is not connected', function (done) {
      this.timeout(15000)

      process.on('uncaughtException', (err) => {
        console.log(' ** uncaughtException')
        console.log(err)
      })

      // new cache with incorrect configuration
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6378 } })
      cache.on('message', (msg) => console.log(msg))
      cache.on('error', (err) => console.log(err))

      cache.set('key1', 'data').then(() => {
        // check a file exists
        setTimeout(function () {
          fs.stat(path.resolve(path.join(cache.cacheHandler.directory, 'key1.json')), (err, stats) => {
            should.exist(stats)
            done()
          })
        }, 1500)
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('get', function () {
    afterEach(function () {
    })

    it.skip('should fallback to file cache when `get` is called and Redis is not connected', sinon.test(function () {
      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6378 } })
      return cache.get('key2').then((stream) => {

      }).catch((err) => {
        err.message.should.eql('The specified key does not exist')
        cache.cacheHandler.constructor.name.should.eql('FileCache')
      })
    }))

    it('should reject if the key cannot be found', sinon.test(function () {
      const client = new RedisMock()
      this.stub(client, 'exists').yields(null, 0)
      this.stub(noderedis, 'createClient').returns(client)

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })

      return cache.get('key1').then(() => {}).catch((err) => {
        err.message.should.eql('The specified key does not exist')
      })
    }))

    it('should return a stream', sinon.test(function (done) {
      const stream = new Stream.Readable()
      stream.push('data')
      stream.push(null)

      const client = new RedisMock()
      this.stub(client, 'exists').yields(null, 1)

      const getRange = this.stub(client, 'getrange')
      getRange.withArgs(new Buffer('key1'), 0, 16383).yields(null, new Buffer('data'))
      getRange.withArgs(new Buffer('key1'), 16384, 32767).yields(null, new Buffer(''))

      this.stub(noderedis, 'createClient').returns(client)

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

  describe('getMetadata', function () {
    it('should return and parse metadata', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'set')

      let metadata = {
        foo: 'bar',
        baz: 123
      }

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data', { metadata }).then(() => {
        cache.getMetadata('key-string').then(metadata => {
          metadata.should.eql(metadata)

          done()
        })
      })
    }))

    it('should return null when there is no metadata for the given key', sinon.test(function (done) {
      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.getMetadata('key-that-does-not-exist').then(err => {
        should.equal(err, null)

        done()
      })
    }))
  })

  describe('flush', function () {
    it('should delete the keys that match a given pattern, along with any associated metadata', sinon.test(function (done) {
      let MockStreamified = function () {}

      MockStreamified.prototype.on = function (event, handler) {
        if (event === 'data') {
          this.dataFn = handler
        } else if (event === 'end') {
          this.dataFn('test-key')

          handler()
        }

        return this
      }

      RedisMock.prototype.streamified = function (method) {
        let mockStreamified = new MockStreamified()

        return () => mockStreamified
      }

      const client = new RedisMock()
      this.stub(noderedis, 'createClient').returns(client)
      const spy = this.spy(client, 'del')

      cache = new Cache({ directory: { enabled: false, path: './cache', extension: 'json' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
      cache.set('key-string', 'data').then(() => {
        cache.flush('key-string').then(() => {
          spy.firstCall.args[0].should.eql('test-key')
          spy.secondCall.args[0].should.eql('___test-key___')

          done()
        })
      })
    }))
  })

  describe('EventEmitter', function () {
    describe('#emit()', function () {
      it('should invoke the callback', function () {
        const spy = sinon.spy()
        const emitter = new EventEmitter()

        emitter.on('foo', spy)
        emitter.emit('foo')
        spy.called.should.equal.true
      })

      it('should pass arguments to the callbacks', function () {
        const spy = sinon.spy()
        const emitter = new EventEmitter()

        emitter.on('foo', spy)
        emitter.emit('foo', 'bar', 'baz')
        sinon.assert.calledOnce(spy)
        sinon.assert.calledWith(spy, 'bar', 'baz')
      })
    })
  })
})
