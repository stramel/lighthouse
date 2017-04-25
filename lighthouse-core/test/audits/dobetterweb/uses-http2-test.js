/**
 * Copyright 2016 Google Inc. All rights reserved.
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

const UsesHTTP2Audit = require('../../../audits/dobetterweb/uses-http2.js');
const assert = require('assert');

const URL = 'https://webtide.com/http2-push-demo/';
const networkRecords = require('../../fixtures/networkRecords-mix.json');
const h2Records = require('../../fixtures/networkRecords-h2push.json');

/* eslint-env mocha */

describe('Resources are fetched over http/2', () => {
  it('fails when some resources were requested via http/1.x', () => {
    return UsesHTTP2Audit.audit({
      URL: {finalUrl: URL},
      devtoolsLogs: {[UsesHTTP2Audit.DEFAULT_PASS]: []},
      requestNetworkRecords: () => Promise.resolve(networkRecords)
    }).then(auditResult => {
      assert.equal(auditResult.rawValue, false);
      assert.ok(auditResult.displayValue.match('4 requests were not'));
      assert.equal(auditResult.extendedInfo.value.results.length, 4);

      const headings = auditResult.extendedInfo.value.tableHeadings;
      assert.deepEqual(Object.keys(headings).map(key => headings[key]),
                      ['URL', 'Protocol'], 'table headings are correct and in order');
    });
  });

  it('displayValue is correct when only one resource fails', () => {
    const entryWithHTTP1 = networkRecords.slice(1, 2);
    return UsesHTTP2Audit.audit({
      URL: {finalUrl: URL},
      devtoolsLogs: {[UsesHTTP2Audit.DEFAULT_PASS]: []},
      requestNetworkRecords: () => Promise.resolve(entryWithHTTP1)
    }).then(auditResult => {
      assert.ok(auditResult.displayValue.match('1 request was not'));
    });
  });

  it('passes when all resources were requested via http/2', () => {
    return UsesHTTP2Audit.audit({
      URL: {finalUrl: URL},
      devtoolsLogs: {[UsesHTTP2Audit.DEFAULT_PASS]: []},
      requestNetworkRecords: () => Promise.resolve(h2Records)
    }).then(auditResult => {
      assert.equal(auditResult.rawValue, true);
      assert.ok(auditResult.displayValue === '');
    });
  });
});
