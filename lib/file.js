'use strict'

const debug = require('debug')('cache:file')
const deleteEmpty = require('remove-empty-directories')
const EventEmitter = require('events')
const fs = require('fs')
const Loki = require('lokijs')
const path = require('path')
const mkdirp = require('mkdirp')
const Stream = require('stream')
const streamifier = require('streamifier')
const recursive = require('recursive-readdir')
const util = require('util')

/**
 * Creates a new FileCache instance
 * @constructor
 * @classdesc This is a description of the FileCache.
 * @param {object} options - the options used to instantiate a FileCache handler
 */
function FileCache (options) {
  this.directory = options.path
  this.extension = options.extension ? '.' + options.extension : ''
  this.directoryChunkSize = (options.directoryChunkSize && Number.isFinite(options.directoryChunkSize)) ? options.directoryChunkSize : 0
  this.ttl = options.ttl || 3600
  this.autoFlushInterval = options.autoFlushInterval || 300
  this.autoFlush = options.autoFlush || false

  if (this.autoFlush) {
    this.enableAutoFlush()
  }

  this.db = this.startDatabase()

  fs.stat(this.directory, (err) => {
    if (err) {
      mkdirp(this.directory, (err, made) => {
        if (err) console.log(err)
        if (made) console.log('Created cache directory', made)
      })
    }
  })
}

util.inherits(FileCache, EventEmitter)

/**
 * @param {String} key - the key to retrieve from cache
 * @returns {Promise.<Stream, Error>} A promise that returns a Stream if the key exists,
 *     or an Error if it does not exist
 */
FileCache.prototype.get = function get (key, options) {
  debug('GET %s %o', key, options)

  let errorNotFound = new Error(
    'The specified key does not exist'
  )

  return this.db.then(db => {
    let match = db.findOne({ $key: key })

    if (!match) {
      return Promise.reject(errorNotFound)
    }

    let lastModified = match.lastModified || 0
    let ttl = options.ttl || this.ttl || 0

    if ((Date.now() - lastModified) / 1000 > ttl) {
      // Removing key from database.
      db.remove(match)

      return Promise.reject(
        new Error('The specified key has expired')
      )
    }

    if (!match.path) {
      // Removing key from database.
      db.remove(match)

      return Promise.reject(errorNotFound)
    }

    return new Promise((resolve, reject) => {
      let stream = fs.createReadStream(match.path)

      // `fs.createReadStream` is asynchronous, so it will never
      // fire an ENOENT error if the file doesn't exist. As a result
      // of that, we rely on the open/error events of the stream to
      // determine whether the Promise should resolve or reject, rather
      // than using a try/catch.
      stream.on('open', () => {
        resolve(stream)
      })

      stream.on('error', () => {
        // Removing key from database.
        db.remove(match)

        reject(errorNotFound)
      })
    })
  })
}

/**
 * Gets a block of metadata for a given key, parsing it as JSON. Waits for the
 * internal database to be initialised and become available.
 *
 * @param  {String} key - cache key
 * @return {Promise.<Object, Error>} A promise that returns the metadata block if it exists,
 *    or an Error otherwise.
 */
FileCache.prototype.getMetadata = function getMetadata (key) {
  return this.db.then(db => {
    let match = db.findOne({ $key: key })

    if (match && match.metadata) {
      return match.metadata
    }

    return null
  })
}

/**
 * @param {String} key - the key to store the data against
 * @param {String|Buffer|Stream} data - the data to cache, as a String, Buffer or Stream
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.set = function set (key, data, options) {
  debug('SET %s %o', key, options)

  return this.db.then(db => {
    db.findAndRemove({ $key: key })

    let cachePath = this.getCachePath(key, options)
    let cacheFile = fs.createWriteStream(cachePath, { flags: 'w' })
    let stream

    // Create a stream from the data if it is a String or Buffer.
    if (data instanceof Buffer || typeof data === 'string') {
      stream = streamifier.createReadStream(data)
    } else if (data instanceof Stream) {
      stream = data
    }

    // Adding to database.
    let lastModified = Date.now()

    db.insert({
      $key: key,
      metadata: options.metadata || null,
      lastModified,
      path: cachePath
    })

    return new Promise((resolve, reject) => {
      stream.pipe(cacheFile)

      cacheFile.on('finish', () => {
        return resolve('')
      }).on('error', err => {
        return reject(err)
      })
    })
  })
}

/**
 * Removes cache files matching a specified pattern and removes empty directories when finished.
 *
 * @param {String} pattern
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.flush = function (pattern) {
  let cachePath = path.resolve(this.directory)
  let re = new RegExp(pattern)

  return this.db.then(db => {
    let matches = db.find({ $key: { $regex: re } })
    let deletedCount = 0

    if (matches.length === 0) {
      return
    }

    return new Promise((resolve, reject) => {
      let registerDeletion = () => {
        if (++deletedCount === matches.length) {
          deleteEmpty(cachePath)

          resolve()
        }
      }

      matches.forEach(match => {
        if (!match.path) return

        try {
          fs.unlink(match.path, registerDeletion)
        } catch (err) {
          console.log(err)

          registerDeletion()
        }

        db.remove(match)
      })
    })
  })
}

/**
 * @param  {String} key - the key to store the data against
 * @returns {String}
 */
FileCache.prototype.getCachePath = function getCachePath (key, options) {
  let folderPath = ''

  // split cache key into chunks to create folders
  if (this.directoryChunkSize > 0) {
    let re = new RegExp('.{1,' + this.directoryChunkSize + '}', 'g')

    folderPath = key.match(re).join('/')
  }

  folderPath = path.resolve(path.join(this.directory, folderPath))

  // ensure this path exists
  try {
    mkdirp.sync(folderPath)
  } catch (err) {
    if (err.code !== 'EEXISTS') throw err
  }

  let extension

  if (options.directory && options.directory.extension) {
    extension = options.directory.extension[0] === '.' ? options.directory.extension : '.' + options.directory.extension
  } else {
    extension = this.extension
  }

  return path.resolve(path.join(folderPath, key + extension))
}

/**
 * Sets up and manages the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.enableAutoFlush = function enableAutoFlush () {
  let timeoutTrigger = () => {
    this.autoFlushTimeout = setTimeout(() => {
      this.autoFlush && this.cleanseCache(this.directory, timeoutTrigger)
    }, this.autoFlushInterval * 1000)
  }

  timeoutTrigger()
}

/**
 * Stops and cleans up the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.disableAutoFlush = function disableAutoFlush () {
  this.autoFlush = false

  if (this.autoFlushTimeout) {
    clearTimeout(this.autoFlushTimeout)
  }
}

/**
 * Trawls a cache directory and removes any cache files that have expired
 * and removes empty directories when finished.
 *
 * @param {String} directory path to cleanse
 * @param {callback} done
 * @returns {void}
 */
FileCache.prototype.cleanseCache = function cleanseCache (dir, done) {
  return this.db.then(db => {
    let matches = db.find()
    let deletionQueue = []

    matches.forEach(match => {
      if (!match.path) return

      if (match.lastModified && (Date.now() - match.lastModified) / 1000 > this.ttl) {
        deletionQueue.push(
          new Promise((resolve, reject) => {
            try {
              fs.unlink(match.path, resolve)
            } catch (err) {
              console.log(err)

              resolve()
            }
          })
        )

        db.remove(match)
      }
    })

    return Promise.all(deletionQueue)
  }).then(() => {
    deleteEmpty(dir)
  })
}

/**
 * Fires up the internal database, loading any existing data from disk.
 *
 * @return {Promise<Collection>} Instance of initialised LokiJS collection
 */
FileCache.prototype.startDatabase = function () {
  return new Promise((resolve, reject) => {
    let db = new Loki(
      path.join(this.directory, 'db.json'),
      {
        autoload: true,
        autoloadCallback: () => {
          let collection = db.getCollection('cache')

          if (collection === null) {
            collection = db.addCollection('cache')
          }

          resolve(collection)
        },
        autosave: true,
        autosaveInterval: 1000
      }
    )
  })
}

/**
 * @param  {Object} options
 * @returns {FileCache} new instance of FileCache
 */
module.exports = function (options) {
  return new FileCache(options)
}
