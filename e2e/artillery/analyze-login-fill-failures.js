#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOGIN_ACTION = 'failed_login';
const LOGIN_REQUEST = 'POST /api/auth/login';
const EMAIL_SELECTOR = '[data-testid="login-email-input"]';
const PASSWORD_SELECTOR = '[data-testid="login-password-input"]';
const BUTTON_SELECTOR = '[data-testid="login-submit-button"]';
const STALL_THRESHOLD_MS = 29000;

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function parseTime(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function pathname(rawUrl) {
    if (!rawUrl) return null;
    try {
        return new URL(rawUrl, 'http://localhost').pathname;
    } catch {
        return null;
    }
}

function detectFailureLocator(message = '') {
    if (/login-email-input/i.test(message)) return 'login-email-input';
    if (/login-password-input/i.test(message)) return 'login-password-input';
    return 'unconfirmed';
}

function isFillError(message = '') {
    return /locator\.fill|\.fill:\s*timeout|\bfill\(/i.test(message);
}

function findAction(report, name, success) {
    return asArray(report.samples?.actions).find((sample) =>
        sample.name === name && (success === undefined || sample.success === success));
}

function loginPostOutcome(report) {
    const allLoginPosts = asArray(report.samples?.http)
        .filter((sample) => sample.name === LOGIN_REQUEST);
    const actionLoginPosts = allLoginPosts.filter((sample) => sample.action === LOGIN_ACTION);
    const statuses = actionLoginPosts.map((sample) => sample.status ?? null);
    let outcome = 'no_request';
    if (actionLoginPosts.length > 0) {
        if (statuses.some((status) => status === null)) outcome = 'transmission_failure';
        else if (actionLoginPosts.length === 1 && statuses[0] === 401) outcome = '401';
        else outcome = 'other_response';
    }
    return {
        outcome,
        requestCount: actionLoginPosts.length,
        exact401Count: actionLoginPosts.filter((sample) => sample.status === 401).length,
        statuses,
        wrongActionRequestCount: allLoginPosts.length - actionLoginPosts.length,
    };
}

function eventOverlapsAction(event, action, vuId) {
    if (asArray(event.vuIds).length > 0 && !event.vuIds.includes(vuId)) return false;
    const actionStart = parseTime(action?.startedAt);
    const actionEnd = parseTime(action?.endedAt);
    const eventStart = parseTime(event.startedAt);
    const eventEnd = parseTime(event.endedAt) ?? eventStart;
    if ([actionStart, actionEnd, eventStart, eventEnd].some((value) => value === null)) return false;
    return eventStart <= actionEnd && eventEnd >= actionStart;
}

function evidenceForVu(evidence, vuId, action) {
    const vuEvidence = evidence?.vus?.[vuId] || {};
    const events = asArray(evidence?.events).filter((event) => eventOverlapsAction(event, action, vuId));
    return { ...vuEvidence, events };
}

function hasLoadPodSaturation(events) {
    const scopes = new Set(['load_pod', 'load-generator', 'load_generator']);
    const signals = new Set(['saturation', 'cpu_throttling', 'memory_pressure', 'oom']);
    return events.some((event) => scopes.has(event.scope) && signals.has(event.signal));
}

function hasFrontendIngressSaturation(events) {
    const scopes = new Set(['frontend', 'ingress']);
    const signals = new Set([
        'saturation', 'cpu_throttling', 'memory_pressure', 'oom', 'restart',
        'http_499', 'http_502', 'http_504', 'document_delay', 'static_delay', 'api_delay',
    ]);
    return events.some((event) => scopes.has(event.scope) && signals.has(event.signal));
}

function hasRuntimeStall(report, action) {
    return asArray(report.samples?.runtime).some((sample) =>
        sample.name === 'event_loop_lag' && sample.durationMs >= 1000 &&
        eventOverlapsAction(sample, action, report.vuId));
}

function hasDeliveryFailure(diagnostics, action) {
    return [...asArray(diagnostics.recentDocuments), ...asArray(diagnostics.recentResources)]
        .some((sample) => (sample.status === 502 || sample.status === 504 || sample.status >= 500) &&
            (sample.action === LOGIN_ACTION || eventOverlapsAction(sample, action, null)));
}

function actionNavigations(report, action) {
    const start = parseTime(action?.startedAt);
    const end = parseTime(action?.endedAt);
    if (start === null || end === null) return [];
    return asArray(report.timeline).filter((item) => item.name === 'navigation' &&
        parseTime(item.at) !== null && parseTime(item.at) >= start && parseTime(item.at) <= end);
}

function urlAtActionStart(report, action) {
    const start = parseTime(action?.startedAt);
    if (start === null) return null;
    return asArray(report.timeline)
        .filter((item) => item.name === 'navigation' && parseTime(item.at) !== null && parseTime(item.at) <= start)
        .sort((left, right) => parseTime(right.at) - parseTime(left.at))[0]?.url || null;
}

function domStateForLocator(locator, diagnostics, vuEvidence) {
    if (locator === 'login-email-input') return diagnostics.ui?.[EMAIL_SELECTOR] || null;
    if (locator === 'login-password-input') {
        return vuEvidence.passwordDom || diagnostics.ui?.[PASSWORD_SELECTOR] || null;
    }
    return null;
}

function describeEvent(event) {
    return [event.scope, event.signal, event.detail].filter(Boolean).join(': ');
}

function classifyFailedVu(report, sourceFile, evidence = null) {
    const action = findAction(report, LOGIN_ACTION, false);
    if (!action) return null;

    const message = action.error?.message || '';
    const failureLocator = action.error?.loginActionLocator || detectFailureLocator(message);
    const failureStep = action.error?.loginActionStep || (failureLocator === 'login-email-input' ? 'email_fill'
        : failureLocator === 'login-password-input' ? 'password_fill' : 'unconfirmed');
    const diagnostics = action.diagnostics || {};
    const vuEvidence = evidenceForVu(evidence, report.vuId, action);
    const startUrl = urlAtActionStart(report, action);
    const failureUrl = diagnostics.url || null;
    const navigations = actionNavigations(report, action);
    const changedNavigation = startUrl ? navigations.find((item) => pathname(item.url) !== pathname(startUrl)) ||
        (failureUrl && pathname(failureUrl) !== pathname(startUrl) ? { url: failureUrl } : null) : null;
    const emailDom = diagnostics.ui?.[EMAIL_SELECTOR] || null;
    const targetDom = domStateForLocator(failureLocator, diagnostics, vuEvidence);
    const formWasReady = Boolean(findAction(report, 'login_form_ready_for_failed_login', true));
    const detachCount = (message.match(/detach(?:ed|ing)?/gi) || []).length;
    const repeatedDetach = vuEvidence.repeatedDetach === true || detachCount >= 2;
    const loadingVisible = vuEvidence.loadingVisible === true;
    const loadPodSaturation = hasLoadPodSaturation(vuEvidence.events);
    const frontendIngressSaturation = hasFrontendIngressSaturation(vuEvidence.events);
    const runtimeStall = hasRuntimeStall(report, action);
    const deliveryFailure = hasDeliveryFailure(diagnostics, action);
    const domMaintained = targetDom?.count > 0 && targetDom.visible === true && targetDom.enabled === true &&
        targetDom.connected !== false && targetDom.editable !== false && targetDom.readOnly !== true;
    const notEditable = targetDom?.count > 0 && (
        targetDom.enabled === false || targetDom.editable === false || targetDom.readOnly === true
    );

    let directCause = 'unclassified';
    let mechanism = null;
    let confidence = 'unconfirmed_hypothesis';
    if (changedNavigation) {
        directCause = 'navigation';
        confidence = 'confirmed_fact';
    } else if (formWasReady && (emailDom?.count === 0 || targetDom?.count === 0 || loadingVisible || repeatedDetach)) {
        directCause = 'dom_replacement';
        mechanism = repeatedDetach ? 'hydration_remount' : loadingVisible ? 'auth_loading_render' : 'locator_disappeared';
        confidence = repeatedDetach ? 'strong_indication' : 'confirmed_fact';
    } else if (notEditable) {
        directCause = 'not_editable';
        mechanism = targetDom.readOnly === true ? 'readonly' : targetDom.enabled === false ? 'disabled' : 'non_editable_element';
        confidence = 'confirmed_fact';
    } else if (action.durationMs >= STALL_THRESHOLD_MS && domMaintained && (loadPodSaturation || runtimeStall)) {
        directCause = 'loadgen_stall';
        mechanism = runtimeStall ? 'event_loop_lag' : 'pod_saturation';
        confidence = 'strong_indication';
    } else if (deliveryFailure || frontendIngressSaturation) {
        directCause = 'frontend_or_ingress_failure';
        mechanism = deliveryFailure ? 'overlapping_5xx' : 'infrastructure_saturation';
        confidence = 'strong_indication';
    }

    let upstreamCause = 'unconfirmed';
    if (loadPodSaturation) upstreamCause = 'load_pod_saturation';
    else if (frontendIngressSaturation) upstreamCause = 'frontend_or_ingress_saturation';

    const hypotheses = [];
    if (directCause === 'unclassified' && action.durationMs >= STALL_THRESHOLD_MS && domMaintained) {
        hypotheses.push('loadgen_stall_requires_runtime_or_pod_evidence');
    }
    if (failureLocator === 'login-password-input' && !targetDom) {
        hypotheses.push('password_dom_state_requires_trace_screenshot_or_call_log');
    }
    if (upstreamCause === 'unconfirmed' && directCause === 'dom_replacement') {
        hypotheses.push('auth_initialization_or_hydration_requires_runtime_evidence');
    }

    const loginPost = loginPostOutcome(report);
    const errorMessageDisplayed = asArray(report.samples?.actions).some((sample) => sample.name === 'register')
        ? 'confirmed_by_scenario_progression' : 'unconfirmed';
    const sequence = {
        formReady: formWasReady ? 'completed' : 'unconfirmed',
        emailFill: failureStep === 'email_fill' ? 'failed'
            : failureStep === 'password_fill' || loginPost.requestCount > 0 ? 'completed' : 'unconfirmed',
        passwordFill: failureStep === 'password_fill' ? 'failed'
            : failureStep === 'email_fill' ? 'not_reached'
                : loginPost.requestCount > 0 ? 'completed' : 'unconfirmed',
        submitClick: loginPost.requestCount > 0 ? 'completed'
            : isFillError(message) ? 'not_reached' : 'unconfirmed',
        loginPost: loginPost.outcome,
        response401: loginPost.exact401Count === 1 ? 'received' : 'not_confirmed',
        errorMessage: errorMessageDisplayed,
    };
    const podEvidence = vuEvidence.events.filter((event) =>
        ['load_pod', 'load-generator', 'load_generator', 'frontend'].includes(event.scope)).map(describeEvent);
    const ingressEvidence = vuEvidence.events.filter((event) => event.scope === 'ingress').map(describeEvent);
    return {
        vuId: report.vuId,
        sourceFile,
        failureLocator,
        failureStep,
        isFillFailure: isFillError(message),
        errorMessage: message,
        actionDurationMs: action.durationMs,
        sequence,
        urlAtActionStart: startUrl,
        urlAtFailure: failureUrl,
        navigationUrls: navigations.map((item) => item.url),
        domState: {
            email: diagnostics.ui?.[EMAIL_SELECTOR] || null,
            password: vuEvidence.passwordDom || diagnostics.ui?.[PASSWORD_SELECTOR] || null,
            button: diagnostics.ui?.[BUTTON_SELECTOR] || null,
            loadingVisible: vuEvidence.loadingVisible ?? null,
            repeatedDetach,
        },
        recentHttp: asArray(diagnostics.recentHttp),
        loginPost,
        errorMessageDisplayed,
        podEvidence,
        ingressEvidence,
        directCause,
        mechanism,
        upstreamCause,
        confidence,
        hypotheses,
    };
}

function countBy(items, property) {
    return items.reduce((counts, item) => {
        const key = item[property];
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function sampleWindow(reports) {
    const timestamps = reports.flatMap((report) => [
        ...asArray(report.samples?.actions).flatMap((sample) => [sample.startedAt, sample.endedAt]),
        ...asArray(report.samples?.http).flatMap((sample) => [sample.startedAt, sample.endedAt]),
    ]).filter((value) => parseTime(value) !== null).sort();
    return { startedAt: timestamps[0] || null, endedAt: timestamps.at(-1) || null };
}

function expectedValue(explicitValue, metadata, reports, metadataPaths) {
    if (explicitValue !== undefined && explicitValue !== null) return explicitValue;
    const candidates = [metadata, ...reports.map((report) => report.metadata)].filter(Boolean);
    for (const candidate of candidates) {
        for (const pathParts of metadataPaths) {
            const value = pathParts.reduce((current, part) => current?.[part], candidate);
            if (Number.isInteger(value) && value >= 0) return value;
        }
    }
    return null;
}

function analyzeReports(entries, options = {}) {
    const reports = entries.map((entry) => entry.report);
    const embeddedMetadata = reports.find((report) => report.metadata)?.metadata || null;
    const effectiveMetadata = options.metadata || embeddedMetadata;
    const expectedVus = expectedValue(options.expectedVus, options.metadata, reports, [
        ['expectations', 'totalVus'], ['workload', 'arrivalCount'], ['vuBatch', 'arrivalCount'], ['expectedVus'],
    ]);
    const expectedFillFailures = expectedValue(options.expectedFillFailures, options.metadata, reports, [
        ['expectations', 'fillFailures'],
    ]);
    const expected401Vus = expectedValue(options.expected401Vus, options.metadata, reports, [
        ['expectations', 'failedLogin401'],
    ]);
    const allRunIdsPresent = reports.every((report) => typeof report.runId === 'string' && report.runId.length > 0);
    const allVuIdsPresent = reports.every((report) => typeof report.vuId === 'string' && report.vuId.length > 0);
    const runIds = [...new Set(reports.map((report) => report.runId).filter(Boolean))];
    const runId = allRunIdsPresent && runIds.length === 1 ? runIds[0] : null;
    const evidenceMatchesRun = !options.evidence || Boolean(runId && options.evidence.runId === runId);
    const evidence = evidenceMatchesRun ? options.evidence : null;
    const failed = entries.map((entry) => classifyFailedVu(entry.report, entry.sourceFile, evidence)).filter(Boolean);
    const allDetails = entries.map((entry) => ({
        vuId: entry.report.vuId,
        failedLoginAction: Boolean(findAction(entry.report, LOGIN_ACTION, false)),
        fillFailure: failed.find((detail) => detail.vuId === entry.report.vuId)?.isFillFailure || false,
        loginPost: loginPostOutcome(entry.report),
    }));
    const exact401Vus = allDetails.filter((detail) =>
        detail.loginPost.requestCount === 1 && detail.loginPost.exact401Count === 1);
    const errorMessageConfirmedVus = reports.filter((report) =>
        asArray(report.samples?.actions).some((sample) => sample.name === 'register')).length;
    const failedFillVus = failed.filter((detail) => detail.isFillFailure);
    const uniqueVuIds = new Set(reports.map((report) => report.vuId).filter(Boolean));
    const expectationsKnown = [expectedVus, expectedFillFailures, expected401Vus]
        .every((value) => Number.isInteger(value));
    const relationConfirmed = expectationsKnown && Boolean(runId) && allVuIdsPresent && reports.length === expectedVus &&
        uniqueVuIds.size === expectedVus &&
        failedFillVus.length === expectedFillFailures && exact401Vus.length === expected401Vus &&
        failedFillVus.every((detail) => detail.loginPost.outcome === 'no_request') &&
        allDetails.filter((detail) => !detail.fillFailure).every((detail) =>
            detail.loginPost.requestCount === 1 && detail.loginPost.exact401Count === 1);

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runId,
        window: sampleWindow(reports),
        expectations: { expectedVus, expectedFillFailures, expected401Vus },
        validity: {
            oneRunId: Boolean(runId),
            allRunIdsPresent,
            runIds,
            expectedRunIdMatches: options.expectedRunId ? runId === options.expectedRunId : null,
            vuFiles: reports.length,
            uniqueVuIds: uniqueVuIds.size,
            allVuIdsPresent,
            expectedVuKnown: Number.isInteger(expectedVus),
            expectedVuCountMatches: Number.isInteger(expectedVus) ? reports.length === expectedVus : null,
            evidenceProvided: Boolean(options.evidence),
            evidenceMatchesRun,
            metadataProvided: Boolean(effectiveMetadata),
            metadataMatchesRun: options.metadata ? options.metadata.runId === runId : embeddedMetadata ? true : null,
        },
        summary: {
            failedLoginActions: failed.length,
            fillFailures: failedFillVus.length,
            failureSteps: countBy(failed, 'failureStep'),
            directCauses: countBy(failed, 'directCause'),
            upstreamCauses: countBy(failed, 'upstreamCause'),
            loginPostOutcomesForFailures: countBy(failed.map((detail) => detail.loginPost), 'outcome'),
            exact401Vus: exact401Vus.length,
            expectedOutcomeRelationConfirmed: relationConfirmed,
            errorMessageConfirmedVus,
            allExpectedFailedLoginOutcomesConfirmed: relationConfirmed &&
                errorMessageConfirmedVus === expected401Vus,
            relation410Plus82Confirmed: relationConfirmed,
        },
        metadata: options.metadata
            ? options.metadata.runId === runId ? options.metadata : null
            : embeddedMetadata,
        excludedEvidence: options.evidence && !evidenceMatchesRun
            ? { runId: options.evidence.runId, reason: 'run_id_mismatch' } : null,
        failedVus: failed,
    };
}

function hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadRunDirectory(runDirectory) {
    const files = fs.readdirSync(runDirectory).filter((file) => /^vu-.*\.json$/.test(file)).sort();
    if (files.length === 0) throw new Error(`No vu-*.json files found in ${runDirectory}`);
    return files.map((file) => {
        const filePath = path.join(runDirectory, file);
        return {
            sourceFile: file,
            sha256: hashFile(filePath),
            report: JSON.parse(fs.readFileSync(filePath, 'utf8')),
        };
    });
}

function buildInputManifest(entries, runDirectory, expectedVus, supportingFiles = []) {
    const root = path.resolve(runDirectory);
    const runIds = [...new Set(entries.map((entry) => entry.report.runId).filter(Boolean))];
    const vuIds = entries.map((entry) => entry.report.vuId).filter(Boolean);
    const artifactFiles = [];
    const missingArtifacts = [];
    const artifactWriteErrors = [];

    for (const entry of entries) {
        const reportArtifacts = asArray(entry.report.artifacts);
        if (asArray(entry.report.samples?.actions).some((action) => action.success === false)) {
            for (const requiredKind of ['error', 'screenshot']) {
                if (!reportArtifacts.some((artifact) => artifact.kind === requiredKind)) {
                    missingArtifacts.push({
                        vuId: entry.report.vuId, kind: requiredKind, path: null, reason: 'missing_reference',
                    });
                }
            }
        }
        for (const artifact of reportArtifacts) {
            if (artifact.writeError) {
                artifactWriteErrors.push({ vuId: entry.report.vuId, kind: artifact.kind, error: artifact.writeError });
                continue;
            }
            if (!artifact.path) continue;
            const artifactPath = path.resolve(root, artifact.path);
            if (artifactPath !== root && !artifactPath.startsWith(`${root}${path.sep}`)) {
                missingArtifacts.push({ vuId: entry.report.vuId, path: artifact.path, reason: 'outside_run_directory' });
                continue;
            }
            if (!fs.existsSync(artifactPath)) {
                missingArtifacts.push({ vuId: entry.report.vuId, path: artifact.path, reason: 'missing' });
                continue;
            }
            artifactFiles.push({
                vuId: entry.report.vuId,
                kind: artifact.kind,
                path: artifact.path,
                sha256: hashFile(artifactPath),
            });
        }
    }

    const expectedVuKnown = Number.isInteger(expectedVus);
    const uniqueVuIds = new Set(vuIds).size;
    const executionIdentities = entries.map((entry) => entry.report.metadata).filter(Boolean).map((metadata) => ({
        targetUrl: metadata.targetUrl || null,
        gitSha: metadata.gitSha || null,
        frontendImage: metadata.images?.frontend || null,
        loadImage: metadata.images?.loadGenerator || null,
    }));
    const allMetadataPresent = executionIdentities.length === entries.length;
    const identityFieldsComplete = allMetadataPresent && executionIdentities.every((identity) =>
        Object.values(identity).every(Boolean));
    const uniqueExecutionIdentities = new Set(executionIdentities.map((identity) => JSON.stringify(identity)));
    const oneExecutionIdentity = identityFieldsComplete && uniqueExecutionIdentities.size === 1;
    const supportingKinds = new Set(supportingFiles.map((source) => source.kind));
    const missingSupportingKinds = ['artillery_result', 'artillery_stdout', 'evidence']
        .filter((kind) => !supportingKinds.has(kind));
    const complete = expectedVuKnown && entries.length === expectedVus && uniqueVuIds === expectedVus &&
        vuIds.length === entries.length && runIds.length === 1 &&
        missingArtifacts.length === 0 && artifactWriteErrors.length === 0 && missingSupportingKinds.length === 0 &&
        oneExecutionIdentity;
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runDirectory: root,
        expectedVus,
        observationFiles: entries.map(({ sourceFile, sha256, report }) => ({
            path: sourceFile, sha256, vuId: report.vuId, runId: report.runId,
        })),
        artifactFiles,
        supportingFiles,
        validity: {
            complete,
            expectedVuKnown,
            observationFiles: entries.length,
            uniqueVuIds,
            allVuIdsPresent: vuIds.length === entries.length,
            oneRunId: runIds.length === 1,
            runIds,
            allMetadataPresent,
            identityFieldsComplete,
            oneExecutionIdentity,
            executionIdentities: [...uniqueExecutionIdentities].map((identity) => JSON.parse(identity)),
            missingArtifacts,
            artifactWriteErrors,
            missingSupportingKinds,
        },
    };
}

function csvCell(value) {
    const text = value === null || value === undefined ? ''
        : typeof value === 'string' ? value : JSON.stringify(value);
    return `"${text.replaceAll('"', '""')}"`;
}

function renderCsv(details) {
    const columns = [
        'vuId', 'failureLocator', 'failureStep', 'urlAtFailure', 'domState', 'loginPost',
        'podEvidence', 'ingressEvidence', 'directCause', 'mechanism', 'upstreamCause', 'confidence', 'hypotheses',
    ];
    return `${columns.map(csvCell).join(',')}\n${details.map((detail) =>
        columns.map((column) => csvCell(detail[column])).join(',')).join('\n')}\n`;
}

function tableCell(value) {
    const text = value === null || value === undefined ? ''
        : typeof value === 'string' ? value : JSON.stringify(value);
    return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderMarkdown(analysis, sources) {
    const { summary, validity } = analysis;
    const facts = [
        `원본 VU 파일: ${validity.vuFiles}개 (고유 VU ID ${validity.uniqueVuIds}개)`,
        `실행 ID: ${analysis.runId || '미확정'}`,
        `failed_login action 실패: ${summary.failedLoginActions}건`,
        `fill 오류로 판별: ${summary.fillFailures}건`,
        `정확한 failed_login POST /api/auth/login 401 VU: ${summary.exact401Vus}건`,
        `로그인 오류 UI 확인 후 다음 시나리오로 진행한 VU: ${summary.errorMessageConfirmedVus}건`,
        `기대 401 + fill 실패 = 전체 VU 관계: ${summary.relation410Plus82Confirmed ? '확정' : '미확정'}`,
        `입력 manifest: ${validity.inputManifestComplete ? '완전' : '불완전'}`,
    ];
    const unresolved = [];
    if (!validity.expectedVuKnown) unresolved.push('metadata 또는 CLI에 기대 VU 수가 없다.');
    else if (!validity.expectedVuCountMatches) unresolved.push(`대상 ${analysis.expectations.expectedVus} VU와 원본 수가 일치하지 않는다.`);
    if (!validity.metadataProvided) unresolved.push('실행 시각·대상 URL·배치·부하 Pod 수 metadata가 없다.');
    if (!validity.inputManifestComplete) unresolved.push('VU·artifact·Artillery 원본·stdout·인프라 evidence manifest가 불완전하다.');
    if (!validity.evidenceProvided) unresolved.push('동시간대 프런트엔드·Ingress·부하 Pod 로그/지표 evidence가 없다.');
    if (validity.evidenceProvided && !validity.evidenceMatchesRun) unresolved.push('evidence 실행 ID가 달라 대상 판정에서 제외했다.');
    if (analysis.failedVus.some((detail) => detail.failureLocator === 'login-password-input' && !detail.domState.password)) {
        unresolved.push('비밀번호 실패 VU의 DOM 상태를 확정할 trace·screenshot·call log가 부족하다.');
    }

    const lines = [
        '# 로그인 fill 실패 분석', '',
        '## 확정 사실', '',
        ...facts.map((fact) => `- ${fact}`), '',
        '## 원인별 집계', '',
        `- 실패 단계: ${JSON.stringify(summary.failureSteps)}`,
        `- 직접 원인: ${JSON.stringify(summary.directCauses)}`,
        `- 상위 원인: ${JSON.stringify(summary.upstreamCauses)}`,
        `- 실패 VU 로그인 POST: ${JSON.stringify(summary.loginPostOutcomesForFailures)}`, '',
        '## 강한 정황', '',
        ...(analysis.failedVus.filter((detail) => detail.confidence === 'strong_indication')
            .map((detail) => `- ${detail.vuId}: ${detail.directCause}${detail.mechanism ? ` (${detail.mechanism})` : ''}`)),
    ];
    if (!lines.at(-1)) lines.push('- 없음');
    lines.push('', '## 미확정 가설 및 추가 자료', '');
    lines.push(...(unresolved.length ? unresolved : ['추가 미확정 항목 없음']).map((item) => `- ${item}`));
    lines.push('', '## 입력 자료 무결성', '', ...sources.map((source) =>
        `- ${source.kind}: ${source.path} (SHA-256 ${source.sha256})`));
    lines.push('', '## 실패 VU 상세', '',
        '| VU ID | 실패 locator | URL | DOM 상태 | 로그인 POST | Pod·Ingress 증거 | 직접 원인 | 상위 원인 |',
        '|---|---|---|---|---|---|---|---|');
    for (const detail of analysis.failedVus) {
        lines.push(`| ${[
            detail.vuId, detail.failureLocator, detail.urlAtFailure, detail.domState, detail.loginPost,
            [...detail.podEvidence, ...detail.ingressEvidence], detail.directCause, detail.upstreamCause,
        ].map(tableCell).join(' | ')} |`);
    }
    return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
    const args = { runDirectory: null };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith('--') && !args.runDirectory) {
            args.runDirectory = path.resolve(value);
            continue;
        }
        const key = value.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
        args[key] = next;
        index += 1;
    }
    if (!args.runDirectory || !args['output-dir']) {
        throw new Error('Usage: node analyze-login-fill-failures.js <run-directory> --output-dir <directory> --evidence <json> --artillery-result <file> --artillery-stdout <file> [--expected-run-id <id>] [--metadata <json>]');
    }
    for (const required of ['evidence', 'artillery-result', 'artillery-stdout']) {
        if (!args[required]) throw new Error(`Missing required --${required}`);
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function main(argv) {
    const args = parseArgs(argv);
    const entries = loadRunDirectory(args.runDirectory);
    const metadata = args.metadata ? readJson(args.metadata) : null;
    const evidence = args.evidence ? readJson(args.evidence) : null;
    const analysis = analyzeReports(entries, {
        expectedRunId: args['expected-run-id'],
        expectedVus: args['expected-vus'] ? Number(args['expected-vus']) : undefined,
        expectedFillFailures: args['expected-fill-failures'] ? Number(args['expected-fill-failures']) : undefined,
        expected401Vus: args['expected-401-vus'] ? Number(args['expected-401-vus']) : undefined,
        metadata,
        evidence,
    });
    const sources = entries.map(({ sourceFile, sha256 }) => ({
        kind: 'observation', path: path.join(args.runDirectory, sourceFile), sha256,
    }));
    for (const [key, kind] of [['artillery-result', 'artillery_result'], ['artillery-stdout', 'artillery_stdout'], ['metadata', 'metadata'], ['evidence', 'evidence']]) {
        if (!args[key]) continue;
        const sourcePath = path.resolve(args[key]);
        sources.push({ kind, path: sourcePath, sha256: hashFile(sourcePath) });
    }
    const manifest = buildInputManifest(
        entries,
        args.runDirectory,
        analysis.expectations.expectedVus,
        sources.filter((source) => source.kind !== 'observation')
    );
    analysis.validity.inputManifestComplete = manifest.validity.complete;
    analysis.sources = sources;

    const outputDirectory = path.resolve(args['output-dir']);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
    fs.writeFileSync(path.join(outputDirectory, 'failed-vus.csv'), renderCsv(analysis.failedVus));
    fs.writeFileSync(path.join(outputDirectory, 'input-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outputDirectory, 'report.md'), renderMarkdown(analysis, sources));
    console.log(JSON.stringify({
        outputDirectory,
        runId: analysis.runId,
        validity: analysis.validity,
        summary: analysis.summary,
    }, null, 2));
    if (!analysis.validity.oneRunId || analysis.validity.expectedRunIdMatches === false ||
        !analysis.validity.evidenceMatchesRun || analysis.validity.metadataMatchesRun === false ||
        !manifest.validity.complete) process.exitCode = 2;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
    analyzeReports,
    buildInputManifest,
    classifyFailedVu,
    detectFailureLocator,
    isFillError,
    loginPostOutcome,
    renderCsv,
    renderMarkdown,
};
