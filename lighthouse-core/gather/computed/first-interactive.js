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

const LONG_TASK_THRESHOLD = 50;
const LONELY_TASK_FMP_DISTANCE = 5000;
const LONELY_TASK_ENVELOPE_SIZE = 250;
const LONELY_TASK_NEIGHBOR_DISTANCE = 1000;

const MAX_QUIET_WINDOW_SIZE = 5000;
const TRACE_BUSY_MSG = 'trace was busy the entire time';

/**
 * @fileoverview This artifact identifies the time the page is "first interactive" as defined below
 * @see https://docs.google.com/document/d/1GGiI9-7KeY3TPqS3YT271upUVimo-XiL5mwWorDUD4c/edit#
 *
 * First Interactive marks the first moment when a website is minimally interactive:
 *    > Enough (but maybe not all) UI components shown on the screen are interactive
 *      DISCLAIMER: This is assumed by virtue of the fact that the CPU is idle, actual event
 *      listeners are not examined, server-side rendering and extreme network latency can dupe this
 *      definition.
 *    > The page responds to user input in a reasonable time on average, but it’s ok if this
 *      response is not always immediate.
 *
 * First Interactive is defined as the first period after FMP of N-seconds where there are no
 * long tasks that are not "lonely".
 *
 *    > t = time in seconds since FMP
 *    > N = f(t) = 4 * e^(-0.045 * t) + 1
 *      5 = f(0) = 4 + 1
 *      3 ~= f(15) ~= 2 + 1
 *      1 ~= f(∞) ~= 0 + 1
 *    > a "lonely" task is an envelope of 250ms at least 5s after FMP that contains a set of long
 *      tasks that have at least 1 second of padding before and after the envelope that contain no
 *      long tasks.
 *
 * If this timestamp is earlier than DOMContentLoaded, use DOMContentLoaded as firstInteractive.
 */
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

    // FirstInteractive must start at the end of a long task, consider each long task and
    // examine the window that follows it.
    for (let i = 0; i < longTasks.length; i++) {
      const event = longTasks[i];
      const windowStart = event.end;
      const windowSize = FirstInteractive.getRequiredWindowSizeInMs(windowStart - FMP);
      const windowEnd = windowStart + windowSize;

      // Check that we have a long enough trace
      if (windowEnd > traceEnd) {
        throw new Error(TRACE_BUSY_MSG);
      }

      let isQuiet = true;
      // Loop over all the long tasks within the window
      // All tasks that we find in the window must be lonely or the window isn't quiet.
      for (let j = i + 1; j < longTasks.length && longTasks[j].start < windowEnd; j++) {
        const lastLonelyTaskIndex = FirstInteractive.getLastLonelyTaskIndex(longTasks, j, FMP,
            traceEnd);
        if (lastLonelyTaskIndex === -1) {
          // We found a task that isn't lonely, this window isn't quiet
          isQuiet = false;
          break;
        } else {
          // Skip over the rest of the lonely task envelope
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
   * @param {!Trace} trace
   * @param {!tr.Model} traceModel
   * @param {!TraceOfTabArtifact} traceOfTab
   * @return {{timeInMs: number, timestamp: number}}
   */
  computeWithArtifacts(trace, traceModel, traceOfTab) {
    const navStart = traceOfTab.timestamps.navigationStart;
    const FMP = traceOfTab.timings.firstMeaningfulPaint;
    const DCL = traceOfTab.timings.domContentLoaded;
    const traceEnd = traceOfTab.timings.traceEnd;

    if (traceEnd - FMP < MAX_QUIET_WINDOW_SIZE) {
      throw new Error('trace not at least 5 seconds longer than FMP');
    }

    const longTasksAfterFMP = TracingProcessor.getMainThreadTopLevelEvents(traceModel, trace, FMP)
        .filter(evt => evt.end - evt.start >= LONG_TASK_THRESHOLD && evt.end > FMP);
    const firstInteractive = FirstInteractive.findQuietWindow(FMP, traceEnd, longTasksAfterFMP);

    const valueInMs = Math.max(firstInteractive, DCL);
    return {
      timeInMs: valueInMs,
      timestamp: (valueInMs + navStart) * 1000,
    };
  }

  /**
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
