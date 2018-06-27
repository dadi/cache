'use strict'

const Cache = require('./../../lib/index')

let cache

describe('FileCache', function () {
  const fileConfig = {
    enabled: true,
    path: './cache'
  }

  afterEach(done => {
    cache = null
    done()
  })

  it('should flush the cache', done => {
    cache = new Cache({ directory: fileConfig, redis: { enabled: false } })
    cache
      .set('foo', 'bar')
      .then(() => {
        cache.flush().then(() => {
          cache
            .get('foo')
            .then(() => {})
            .catch(err => {
              ;(err instanceof Error).should.equal(true)
              err.message.should.eql('The specified key does not exist')
              done()
            })
        })
      })
      .catch(err => {
        console.log('set err', err)
      })
  })
})
