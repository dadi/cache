var should = require('should')
var Cache = require(__dirname + '/../../lib/index')

describe('Cache', function () {
  it('should allow instantiating a Cache instance', function () {
    var cache = new Cache()
    return cache.should.not.be.null
  })

  // it('should throw if invalid options are passed to the constructor', function () {
  //   return should.throws(function() { var cache = new Cache({ enabled: true  }) })
  // })

  it('should not be enabled if type == directory && enabled == false', function () {
    var cache = new Cache({ directory: { enabled: false, path: './cache' }, redis: { enabled: false } })
    return cache.enabled.should.eql(false)
  })

  // it('should throw if type == directory && path == null', function () {
  //   return should.throws(function() { var cache = new Cache({ type: 'directory', enabled: false }) })
  // })

  it('should be enabled if type == directory && enabled == true', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache' }, redis: { enabled: false } })
    return cache.enabled.should.eql(true)
  })

  it('should ignore falsy keys', function () {
    var cache = new Cache({ expireAt: null, directory: { enabled: true, path: './cache' }, redis: { enabled: false } })
    return cache.enabled.should.eql(true)
  })

  // it('should throw if type == redis && host == null', function () {
  //   return should.throws(function() { var cache = new Cache({ type: 'redis', enabled: true }) })
  // })

  // it('should throw if type == redis && port == null', function () {
  //   return should.throws(function() { var cache = new Cache({ type: 'redis', enabled: true, host: '127.0.0.1' }) })
  // })

  it('should be enabled if type == redis && enabled == true', function () {
    var cache = new Cache({ directory: { enabled: false }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
    return cache.enabled.should.eql(true)
  })

  it('should create a FileCache if type == directory', function () {
    var cache = new Cache({ directory: { enabled: true, path: './cache' }, redis: { enabled: false, host: '127.0.0.1', port: 6379 } })
    return cache.cacheHandler.constructor.name.should.eql('FileCache')
  })

  it('should create a RedisCache if type == redis', function () {
    var cache = new Cache({ directory: { enabled: false, path: './cache' }, redis: { enabled: true, host: '127.0.0.1', port: 6379 } })
    return cache.cacheHandler.constructor.name.should.eql('RedisCache')
  })
})