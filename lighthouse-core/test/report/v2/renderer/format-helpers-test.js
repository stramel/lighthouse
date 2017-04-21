/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const assert = require('assert');
const helpers = require('../../../../report/v2/renderer/format-helpers.js');
const sampleResults = require('../../../results/sample_v2.json');

/* eslint-env mocha */

describe('format-helpers', () => {
  it('formats a number', () => {
    assert.strictEqual(helpers.formatNumber(10), '10');
    assert.strictEqual(helpers.formatNumber(100.01), '100');
    assert.strictEqual(helpers.formatNumber(13000.456), '13,000.5');
  });

  it('formats a date', () => {
    const timestamp = helpers.formatDateTime(sampleResults.generatedTime);
    assert.ok(timestamp.includes('Apr 5, 2017'));
  });

  it('calculates a score ratings', () => {
    assert.equal(helpers.calculateRating(0), 'fail');
    assert.equal(helpers.calculateRating(10), 'fail');
    assert.equal(helpers.calculateRating(45), 'average');
    assert.equal(helpers.calculateRating(55), 'average');
    assert.equal(helpers.calculateRating(75), 'pass');
    assert.equal(helpers.calculateRating(80), 'pass');
    assert.equal(helpers.calculateRating(100), 'pass');
  });
});
