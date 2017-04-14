/**
 * @license
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

const ComputedArtifact = require('./computed-artifact');
const TracingProcessor = require('../../lib/traces/tracing-processor');

const LONELY_TASK_FMP_DISTANCE = 5000;
const LONELY_TASK_ENVELOPE_SIZE = 250;
const LONELY_TASK_NEIGHBOR_DISTANCE = 1000;

const MAX_QUIET_WINDOW_SIZE = 5000;
const TRACE_BUSY_MSG = 'trace was busy the entire time';

class FirstInteractive extends ComputedArtifact {
  get name() {
    return 'FirstInteractive';
  }

  /**
   * @param {number} t The time passed since FMP in miliseconds.
   * @return {number}
   */
  static getRequiredWindowSizeInMs(t) {
    const tInSeconds = t / 1000;
    const exponentiationComponent = Math.exp(-.045 * tInSeconds);
    return (4 * exponentiationComponent + 1) * 1000;
  }

  /**
   * @param {!Array<{start: number, end: number>}} longTasks
   * @param {number} i
   * @param {number} FMP
   * @param {number} traceEnd
   * @return {number} The last index of the lonely task envelope,
   *    -1 if not a lonely task
   */
  static getLastLonelyTaskIndex(longTasks, i, FMP, traceEnd) {
    const longTask = longTasks[i];
    const previousTask = longTasks[i - 1];
    if (longTask.start < FMP + LONELY_TASK_FMP_DISTANCE ||
        traceEnd - longTask.end < LONELY_TASK_NEIGHBOR_DISTANCE ||
        longTask.start - previousTask.end < LONELY_TASK_NEIGHBOR_DISTANCE ||
        longTask.end - longTask.start > LONELY_TASK_ENVELOPE_SIZE) {
      return -1;
    }

    let lonelyTaskIndex = i;
    const envelopeEnd = longTask.start + LONELY_TASK_ENVELOPE_SIZE;
    const windowEnd = envelopeEnd + LONELY_TASK_NEIGHBOR_DISTANCE;
    for (let j = i + 1; longTasks[j] && longTasks[j].start < windowEnd; j++) {
      if (longTasks[j].end > envelopeEnd) {
        lonelyTaskIndex = -1;
      } else {
        lonelyTaskIndex = j;
      }
    }

    return lonelyTaskIndex;
  }

  /**
   * @param {number} FMP
   * @param {number} traceEnd
   * @param {!Array<{start: number, end: number>}} longTasks
   * @return {number}
   */
  static findQuietWindow(FMP, traceEnd, longTasks) {
    if (longTasks.length === 0 ||
        longTasks[0].start > FMP + MAX_QUIET_WINDOW_SIZE) {
      return FMP;
    }

    for (let i = 0; i < longTasks.length; i++) {
      const event = longTasks[i];
      const windowStart = event.end;
      const windowSize = FirstInteractive.getRequiredWindowSizeInMs(windowStart - FMP);
      const windowEnd = windowStart + windowSize;
      if (windowEnd > traceEnd) {
        throw new Error(TRACE_BUSY_MSG);
      }

      let isQuiet = true;
      for (let j = i + 1; j < longTasks.length && longTasks[j].start < windowEnd; j++) {
        const lastLonelyTaskIndex = FirstInteractive.getLastLonelyTaskIndex(longTasks, j, FMP,
            traceEnd);
        if (lastLonelyTaskIndex === -1) {
          isQuiet = false;
          break;
        } else {
          j = lastLonelyTaskIndex;
        }
      }

      if (isQuiet) {
        return windowStart;
      }
    }

    throw new Error(TRACE_BUSY_MSG);
  }

  /**
   * @param {!Object} trace
   * @param {!Object} traceModel
   * @param {!Object} traceOfTab
   * @return {!Object}
   */
  computeWithArtifacts(trace, traceModel, traceOfTab) {
    const navStart = traceOfTab.timestamps.navigationStart;
    const FMP = traceOfTab.timings.firstMeaningfulPaint;
    const DCL = traceOfTab.timings.domContentLoaded;
    const traceEnd = traceOfTab.timings.traceEnd;

    if (traceEnd - FMP < MAX_QUIET_WINDOW_SIZE) {
      throw new Error('trace not at least 5 seconds longer than FMP');
    }

    const longTasks = TracingProcessor.getMainThreadTopLevelEvents(traceModel, trace, FMP)
        .filter(evt => evt.end - evt.start >= 50 && evt.end > FMP);
    const firstInteractive = FirstInteractive.findQuietWindow(FMP, traceEnd,
        longTasks);

    const valueInMs = Math.max(firstInteractive, DCL);
    return {
      timeInMs: valueInMs,
      timestamp: (valueInMs + navStart) * 1000,
    };
  }

  /**
   * Identify the time the page is "first interactive"
   * @see https://docs.google.com/document/d/1GGiI9-7KeY3TPqS3YT271upUVimo-XiL5mwWorDUD4c/edit#
   *
   * @param {!Object} trace
   * @param {!Object} artifacts
   * @return {!Object}
   */
  compute_(trace, artifacts) {
    return Promise.all([
      artifacts.requestTracingModel(trace),
      artifacts.requestTraceOfTab(trace),
    ]).then(([traceModel, traceOfTab]) => {
      return this.computeWithArtifacts(trace, traceModel, traceOfTab);
    });
  }
}

module.exports = FirstInteractive;
