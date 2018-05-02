var exec = require('child_process').exec
var fs = require('fs')
var fsExtra = require('fs-extra')
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

  describe('flush', function () {
    this.timeout(5000)

    beforeEach(function (done) {
      var setup = function (dir) {
        return new Promise((resolve, reject) => {
          exec('mkdir ' + dir, (err, y, z) => {
            // console.log(err)
            return resolve()
          })
        })
      }

      var cache = new Cache({ directory: { enabled: true, path: './cache' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
      setTimeout(() => {
        setup(path.resolve(cache.cacheHandler.directory)).then(done)
      }, 2000)
    })

    it('should use default autoFlush interval if none is specfied', function () {
      var cache = new Cache({ directory: { enabled: true, path: './cache' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

      cache.cacheHandler.autoFlushInterval.should.not.be.NaN()
      cache.cacheHandler.autoFlushInterval.should.be.above(0)
    })

    it('should use autoFlush interval if one is specfied', function () {
      var specificautoFlushInterval = 600
      var cache = new Cache({ directory: { enabled: true, path: './cache', autoFlushInterval: specificautoFlushInterval }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

      cache.cacheHandler.autoFlushInterval.should.not.be.NaN()
      cache.cacheHandler.autoFlushInterval.should.equal(specificautoFlushInterval)
    })

    it('should remove an expired file when cache cleansing is enabled', function (done) {
      var cache = new Cache({ ttl: 1, directory: { enabled: true, path: './cache', autoFlush: true, autoFlushInterval: 1 }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
      var filePath = path.resolve(path.join(cache.cacheHandler.directory, 'test_file'))
      fs.writeFileSync(filePath, 'testfile')

      setTimeout(() => {
        fs.stat(filePath, (err, stats) => {
          should.exist(err)
          should.not.exist(stats)
          done()
        })
      }, 2000)
    })

    it('should remove empty directories when cache cleansing is finished', function (done) {
      var cache = new Cache({ ttl: 1, directory: { enabled: true, path: './cache', autoFlush: true, autoFlushInterval: 1 }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

      var dir = path.resolve(path.join(cache.cacheHandler.directory, 'test'))
      exec('mkdir -p ' + dir, (err, y, z) => {
        var filePath = dir + '/test_file'
        fs.writeFileSync(filePath, 'testfile')

        setTimeout(() => {
          fs.stat(dir, (err, stats) => {
            should.exist(err)
            should.not.exist(stats)
            done()
          })
        }, 2000)
      })
    })

    it('should not remove an unexpired file when cache cleansing is enabled', function (done) {
      var cache = new Cache({ ttl: 60, directory: { enabled: true, path: './cache', autoFlush: true, autoFlushInterval: 1 }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
      var filePath = path.resolve(path.join(cache.cacheHandler.directory, 'test_file'))
      fs.writeFileSync(filePath, 'testfile')

      setTimeout(() => {
        fs.stat(filePath, (err, stats) => {
          should.not.exist(err)
          should.exist(stats)
          cache.cacheHandler.disableAutoFlush()
          done()
        })
      }, 2000)
    })
  })

  describe('set', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache', extension: 'json' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

    beforeEach(function (done) {
      var setup = function (dir) {
        return new Promise((resolve, reject) => {
          exec('mkdir ' + dir)
          return resolve()
        })
      }

      setup(path.resolve(cache.cacheHandler.directory)).then(done)
    })

    afterEach(function () {
      var files = fs.readdirSync(cache.cacheHandler.directory)
      files.forEach((file) => {
        try {
          fs.unlinkSync(cache.cacheHandler.directory + '/' + file)
        } catch (err) {}
      })
    })

    it('should generate a cache filename from the directory and key', sinon.test(function () {
      var spy = this.spy(fs, 'createWriteStream')
      cache.set('key1', 'data')

      return spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
    }))

    it('should create a cache file when a String is passed', function (done) {
      cache.set('key1', 'data')

      // check a file exists
      fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
        (!err).should.eql(true)
        done()
      })
    })

    it('should create a cache file when a Buffer is passed', function (done) {
      var buffer = new Buffer('data')
      cache.set('key1', buffer)

      // check a file exists
      fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
        (!err).should.eql(true)
        done()
      })
    })

    it('should create a cache file when a Stream is passed', function (done) {
      var stream = new Stream.Readable()
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

  describe('metadata', function () {
    this.timeout(5000)

    let cache
    let metadata = {
      foo: 'bar',
      baz: 123
    }

    beforeEach(done => {
      cache = new Cache({
        directory: {
          enabled: true,
          path: './cache',
          extension: 'json'
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      setTimeout(done, 2000)
    })

    afterEach(() => {
      fsExtra.removeSync(
        path.join(__dirname, './../../db.json')
      )
    })

    it('should save metadata alongside a String payload', () => {
      return cache.set('key1', 'data', { metadata }).then(() => {
        return cache.get('key1')
      }).then(result => {
        should.exist(result)

        return cache.getMetadata('key1')
      }).then(result => {
        result.should.eql(metadata)
      })
    })

    it('should save metadata alongside a Buffer payload', () => {
      let buffer = new Buffer('data')

      return cache.set('key1', buffer, { metadata }).then(() => {
        return cache.get('key1')
      }).then(result => {
        should.exist(result)

        return cache.getMetadata('key1')
      }).then(result => {
        result.should.eql(metadata)
      })
    })

    it('should save metadata alongside a Stream payload', () => {
      let stream = new Stream.Readable()
      stream.push('data')
      stream.push(null)

      return cache.set('key1', stream, { metadata }).then(() => {
        return cache.get('key1')
      }).then(result => {
        return cache.getMetadata('key1')
      }).then(result => {
        result.should.eql(metadata)
      })
    })

    it('should persist metadata database to disk and reload it on instantiation', () => {
      return cache.set('key1', 'data', { metadata }).then(() => {
        return cache.get('key1')
      }).then(result => {
        return cache.getMetadata('key1')
      }).then(result => {
        result.should.eql(metadata)

        return new Promise((resolve, reject) => {
          setTimeout(resolve, 1500)
        }).then(() => {
          let newCache = new Cache({
            directory: {
              enabled: true,
              path: './cache',
              extension: 'json'
            },
            redis: {
              enabled: false,
              host: '127.0.0.1',
              port: 6379
            }
          })

          return cache.getMetadata('key1')
        }).then(result => {
          result.should.eql(metadata)
        })
      })
    })

    it('should delete any metadata associated with a key when it\'s flushed', done => {
      cache.set('key2', 'data', { metadata }).then(() => {
        return cache.get('key2')
      }).then(stream => {
        should.exist(stream)

        return cache.getMetadata('key2')
      }).then(result => {
        result.should.eql(metadata)

        return cache.flush('key*')
      }).then(() => {
        return cache.get('key2').catch(err => {
          err.message.should.eql(
            'The specified key does not exist'
          )

          return cache.getMetadata('key2').then(result => {
            should.equal(result, null)

            done()
          })
        })
      })
    })

    it('should not delete metadata associated with a key when another key is flushed', () => {
      cache.set('key3', 'data', { metadata }).then(() => {
        return cache.get('key3')
      }).then(stream => {
        should.exist(stream)

        return cache.getMetadata('key3')
      }).then(result => {
        result.should.eql(metadata)

        return cache.flush('key2')
      }).then(() => {
        return cache.get('key3')
      }).then(result => {
        result.should.eql(metadata)
      })
    })

    it('should return null when trying to get metadata for a key that doesn\'t have any', () => {
      return cache.getMetadata('key-that-does-not-exist').then(result => {
        should.equal(result, null)
      })
    })
  })

  describe('get', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache', extension: 'json' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })

    after(function () {
      // remove cache folder contents completely, and recreate
      var cleanup = function (dir) {
        exec('rm -r ' + dir, function (err, stdout, stderr) {
          exec('mkdir ' + dir)
        })
      }

      cleanup(path.resolve(cache.cacheHandler.directory))
    })

    it('should generate a cache filename from the directory and key', sinon.test(function () {
      var spy = this.spy(fs, 'stat')

      cache.set('key1', 'data')
      cache.get('key1')

      return spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
    }))

    it('should generate a cache path with subdirectories when directoryChunkSize is set', sinon.test(function () {
      var cacheWithChunks = new Cache({ directory: { enabled: true, path: './cache', extension: 'json', directoryChunkSize: 4 }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
      var spy = this.spy(fs, 'stat')

      var key = '1073ab6cda4b991cd29f9e83a307f34004ae9327'
      var expectedPath = path.resolve(cacheWithChunks.cacheHandler.directory + '/1073/ab6c/da4b/991c/d29f/9e83/a307/f340/04ae/9327' + '/1073ab6cda4b991cd29f9e83a307f34004ae9327.json')

      cacheWithChunks.set(key, 'data')

      cacheWithChunks.get(key)
      return spy.firstCall.args[0].should.eql(expectedPath)
    }))

    it('should generate a cache path with uneven-length subdirectories when directoryChunkSize is set', sinon.test(function () {
      var cacheWithChunks = new Cache({ directory: { enabled: true, path: './cache', extension: 'json', directoryChunkSize: 7 }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
      var spy = this.spy(fs, 'stat')

      var key = '1073ab6cda4b991cd29f9e83a307f34004ae9327'
      var expectedPath = path.resolve(cacheWithChunks.cacheHandler.directory + '/1073ab6/cda4b99/1cd29f9/e83a307/f34004a/e9327' + '/1073ab6cda4b991cd29f9e83a307f34004ae9327.json')

      cacheWithChunks.set(key, 'data')

      cacheWithChunks.get(key)
      return spy.firstCall.args[0].should.eql(expectedPath)
    }))

    it('should reject if the key cannot be found', function (done) {
      cache.set('key1', 'data')
      cache.get('key2').then((stream) => {

      }).catch((err) => {
        err.message.should.eql('The specified key does not exist')
        done()
      })
    })

    it('should reject if the key has expired')

    it('should return a stream', function (done) {
      cache.set('key1', 'data')
      cache.get('key1').then((stream) => {
        stream.should.exist
        done()
      })
    })
  })
})
