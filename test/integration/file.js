'use strict'

const fs = require('fs')
const path = require('path')
const should = require('should')
const toString = require('stream-to-string')

const Cache = require(__dirname + '/../../lib/index')
const FileCache = require(__dirname + '/../../lib/file')

var cache

describe('FileCache', function () {
  const fileConfig = {
    enabled: true,
    path: './cache'
  }

  afterEach((done) => {
    cache = null
    done()
  })

  it('should flush the cache', (done) => {
    cache = new Cache({ directory: fileConfig, redis: { enabled: false } })
    cache.set('foo', 'bar').then(() => {
      cache.flush().then(() => {
        cache.get('foo')
          .then(() => {})
          .catch((err) => {
            (err instanceof Error).should.equal(true)
            err.message.should.eql('The specified key does not exist')
            done()
          })
      })
    }).catch((err) => {
      console.log('set err', err)
    })
  })
})
