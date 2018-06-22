const Cache = require('./../../lib/index')
const exec = require('child_process').exec
const FileCache = require('./../../lib/file')
const fs = require('fs')
const fsExtra = require('fs-extra')
const path = require('path')
const should = require('should')
const sinon = require('sinon')
const Stream = require('stream')

describe('FileCache', function () {
  beforeEach(done => {
    exec(`rm -rf cache/*`, (err, y, z) => {
      done(err)
    })
  })

  it('should use empty string extension if none is specfied', function () {
    let cache = new Cache({
      directory: {
        enabled: true,
        path: './cache'
      },
      redis: {
        enabled: false,
        host: '127.0.0.1',
        port: 6379
      }
    })

    let handler = cache.cacheHandler

    return handler.extension.should.eql('')
  })

  it('should use extension if one is specfied', function () {
    let cache = new Cache({
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

    let handler = cache.cacheHandler

    return handler.extension.should.eql('.json')
  })

  describe('flush', function () {
    this.timeout(5000)

    beforeEach(function (done) {
      let setup = function (dir) {
        return new Promise((resolve, reject) => {
          exec('mkdir ' + dir, (err, y, z) => {
            return resolve()
          })
        })
      }

      let cache = new Cache({
        directory: {
          enabled: true,
          path: './cache'
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      setTimeout(() => {
        setup(path.resolve(cache.cacheHandler.directory)).then(done)
      }, 2000)
    })

    it('should remove files that match the given pattern and leave the other ones untouched', () => {
      let cache = new Cache({
        ttl: 1,
        directory: {
          enabled: true,
          path: './cache',
          autoFlush: false
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      return cache.set('keyone', 'data').then(() => {
        return cache.set('keytwo', 'data')
      }).then(() => {
        return cache.set('keythree', 'data')
      }).then(() => {
        return cache.flush('two')
      }).then(() => {
        return cache.get('keyone')
      }).then(res => {
        should.exist(res)

        return cache.get('keytwo').catch(err => {
          should.exist(err)
          err.message.should.eql(
            'The specified key does not exist'
          )
        })
      }).then(() => {
        return cache.get('keyone')
      }).then(res => {
        should.exist(res)
      })
    })    

    it('should use default autoFlush interval if none is specfied', function () {
      let cache = new Cache({
        directory: {
          enabled: true,
          path: './cache'
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      cache.cacheHandler.autoFlushInterval.should.not.be.NaN()
      cache.cacheHandler.autoFlushInterval.should.be.above(0)
    })

    it('should use autoFlush interval if one is specfied', function () {
      let specificautoFlushInterval = 600
      let cache = new Cache({
        directory: {
          enabled: true,
          path: './cache',
          autoFlushInterval: specificautoFlushInterval
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      cache.cacheHandler.autoFlushInterval.should.not.be.NaN()
      cache.cacheHandler.autoFlushInterval.should.equal(specificautoFlushInterval)
    })

    it('should remove an expired file when cache cleansing is enabled', function (done) {
      let cache = new Cache({
        ttl: 1,
        directory: {
          enabled: true,
          path: './cache',
          autoFlush: true,
          autoFlushInterval: 1.5
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      cache.set('key1', 'data').then(() => {
        let filePath = cache.cacheHandler.directory + '/key1'

        setTimeout(() => {
          fs.stat(filePath, (err, stats) => {
            should.not.exist(err)
            should.exist(stats)
          })
        }, 50)

        setTimeout(() => {
          fs.stat(filePath, (err, stats) => {
            should.exist(err)
            should.not.exist(stats)
            done()
          })
        }, 2000)
      })
    })

    it('should remove empty directories when cache cleansing is finished', function (done) {
      let cache = new Cache({
        ttl: 1,
        directory: {
          enabled: true,
          path: './cache',
          autoFlush: true,
          autoFlushInterval: 1.5,
          directoryChunkSize: 3
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      cache.set('onetwothree', 'data').then(() => {
        let firstLevel = path.resolve(
          path.join(
            cache.cacheHandler.directory,
            'one'
          )
        )
        let filePath = path.join(
          firstLevel,
          'two',
          'thr',
          'ee',
          'onetwothree'
        )

        setTimeout(() => {
          fs.stat(filePath, (err, stats) => {
            should.not.exist(err)
            should.exist(stats)
            stats.isFile().should.eql(true)
          })
        }, 300)

        setTimeout(() => {
          fs.stat(firstLevel, (err, stats) => {
            should.exist(err)
            should.not.exist(stats)
            done()
          })
        }, 4000)
      })
    })

    it('should not remove an unexpired file when cache cleansing is enabled', function (done) {
      let cache = new Cache({
        ttl: 60,
        directory: {
          enabled: true,
          path: './cache',
          autoFlush: true,
          autoFlushInterval: 1
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })

      let filePath = path.resolve(path.join(cache.cacheHandler.directory, 'test_file'))
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
    let cache = new Cache({
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

    beforeEach(function (done) {
      let setup = function (dir) {
        return new Promise((resolve, reject) => {
          exec('mkdir ' + dir)
          return resolve()
        })
      }

      setup(path.resolve(cache.cacheHandler.directory)).then(done)
    })

    afterEach(function () {
      let files = fs.readdirSync(cache.cacheHandler.directory)
      files.forEach((file) => {
        try {
          fs.unlinkSync(cache.cacheHandler.directory + '/' + file)
        } catch (err) {}
      })
    })

    it('should generate a cache filename from the directory and key', function (done) {
      let spy = sinon.spy(fs, 'createWriteStream')

      cache.set('key1', 'data').then(() => {
        spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
        done()
      })
    })

    it('should create a cache file when a String is passed', function (done) {
      cache.set('key1', 'data').then(() => {
      // check a file exists
        fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
          (!err).should.eql(true)
          done()
        })
      })
    })

    it('should create a cache file when a Buffer is passed', function (done) {
      let buffer = new Buffer('data')
      cache.set('key1', buffer).then(() => {
        // check a file exists
        fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
          (!err).should.eql(true)
          done()
        })
      })
    })

    it('should create a cache file when a Stream is passed', function (done) {
      let stream = new Stream.Readable()
      stream.push('data')
      stream.push(null)
      cache.set('key1', stream).then(() => {
        // check a file exists
        fs.stat(cache.cacheHandler.directory + '/key1.json', (err, stats) => {
          (!err).should.eql(true)
          done()
        })
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
    let cache = new Cache({
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

    after(function () {
      // remove cache folder contents completely, and recreate
      let cleanup = function (dir) {
        exec('rm -r ' + dir, function (err, stdout, stderr) {
          exec('mkdir ' + dir)
        })
      }

      cleanup(path.resolve(cache.cacheHandler.directory))
    })

    it('should generate a cache filename from the directory and key', function (done) {
      let spy = sinon.spy(fs, 'createReadStream')

      cache.set('key1', 'data').then(() => {
        cache.get('key1').then(() => {
          fs.createReadStream.restore()
          spy.firstCall.args[0].should.eql(path.resolve(cache.cacheHandler.directory + '/key1.json'))
          done()
        })
      })
    })

    it('should generate a cache path with subdirectories when directoryChunkSize is set', function (done) {
      let cacheWithChunks = new Cache({
        directory: {
          enabled: true,
          path: './cache',
          extension: 'json',
          directoryChunkSize: 4
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })
      let spy = sinon.spy(fs, 'createReadStream')

      let key = '1073ab6cda4b991cd29f9e83a307f34004ae9327'
      let expectedPath = path.resolve(cacheWithChunks.cacheHandler.directory + '/1073/ab6c/da4b/991c/d29f/9e83/a307/f340/04ae/9327' + '/1073ab6cda4b991cd29f9e83a307f34004ae9327.json')

      cacheWithChunks.set(key, 'data')

      cacheWithChunks.get(key).then(() => {
        fs.createReadStream.restore()
        spy.firstCall.args[0].should.eql(expectedPath)
        done()
      })
    })

    it('should generate a cache path with uneven-length subdirectories when directoryChunkSize is set', function (done) {
      let cacheWithChunks = new Cache({
        directory: {
          enabled: true,
          path: './cache',
          extension: 'json',
          directoryChunkSize: 7
        },
        redis: {
          enabled: false,
          host: '127.0.0.1',
          port: 6379
        }
      })
      let spy = sinon.spy(fs, 'createReadStream')

      let key = '1073ab6cda4b991cd29f9e83a307f34004ae9327'
      let expectedPath = path.resolve(cacheWithChunks.cacheHandler.directory + '/1073ab6/cda4b99/1cd29f9/e83a307/f34004a/e9327' + '/1073ab6cda4b991cd29f9e83a307f34004ae9327.json')

      cacheWithChunks.set(key, 'data')

      cacheWithChunks.get(key).then(() => {
        fs.createReadStream.restore()
        spy.firstCall.args[0].should.eql(expectedPath)
        done()
      })
    })

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
