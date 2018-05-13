# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [2.0.0] - 2018-05-13

Add metadata methods to allow storing additional information with cached data

## [1.5.0] - 2018-04-13

Remove empty directories on cache flush

## [1.4.0] - 2017-03-05

Rewrite for cluster buffer and disabled reconnection

## [1.3.0] - 2016-12-29
### Changed
* Configuration properties `cleanseEnabled` and `cleanseInterval` have been renamed to `autoFlush` and `autoFlushInterval` respectively.

## [1.1.1] - 2016-10-12
### Added
- further configuration options documentation for file caching

## [1.1.1] - 2016-10-11
### Added
- retry strategy for Redis Cluster connections
- documentation for Redis Cluster hosts

## [1.1.0] - 2016-10-11
### Added
- full usage documentation

### Changed
- fixed the reconnection message output

## [1.0.0] - 2016-10-07
### Added
- this file
- travis-ci build file

### Changed
- set version to 1.0.0 in anticipation of release
- updated ioredis-mock to latest version
- ioredis-mock.expire & ioredis-mock.getrange now used instead of our own stub

## [0.0.1-Beta] - 2016-08-03
### Added
- project created
- ioredis used in place of node-redis

