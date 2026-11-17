import { createHash } from 'node:crypto';

export const TTL = 900;
export const CLOCK_SKEW_MS = 60000;
export const TOKEN = /^[^\s\x00-\x1f\x7f]{1,8192}(?![\s\S])/;
export const ROOM = /^[A-Z0-9]{12}$(?![\s\S])/;
export const isId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort(), wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
const word = (value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$(?![\s\S])/.test(value);
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()
  && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && value.trim() === value;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function iso(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$(?![\s\S])/.test(raw)) throw new Error('Expected a UTC timestamp.');
  const time = Date.parse(raw);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== raw.slice(0, 19)) throw new Error('Invalid UTC timestamp.');
  return new Date(time).toISOString();
}



export const MAX_FRAMES = 100000000;
const safeId = value => word(value) && value.length <= 12 && !['constructor', 'prototype', '__proto__', 'unknown'].includes(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const POLICY = Object.freeze({ name: 'ordered-video-cuts-v1', rangeConvention: 'zero-based half-open [in,out)',
  timeline: 'one contiguous video track starting at frame zero; scene array order', rate: 'common integer frames per second; one source frame per timeline frame',
  selection: 'one named take per scene; Unknown withholds the entire timeline', media: 'declared metadata only; no media read, verified, rendered or uploaded',
  excluded: 'audio, transitions, gaps, overlaps, speed changes, fractional fps, timecode and EDL interchange formats' });
export const POLICY_HASH = hash(POLICY);
const promptFor = (input, scene) => `${input.title}\nScene ${input.scenes.indexOf(scene) + 1}: ${scene.id} — ${scene.label}\n${input.fps} fps; source frames [in,out), end excluded.\n${scene.takes.map(take => `${take.id}: ${take.label}; ${take.sourceId} [${take.sourceIn},${take.sourceOut})`).join('\n')}\nChoose one take for the new cut timeline, or Unknown. Review the source media separately.`;

export function validateInput(input) {
  if (!keys(input, ['projectId', 'title', 'fps', 'sources', 'scenes']) || !word(input.projectId) || !line(input.title, 40)
    || !integer(input.fps, 1, 120) || !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8
    || !Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 8) throw new Error('Supply a project ID, title, integer fps 1–120 and one to eight sources and ordered scenes.');
  const sourceIds = new Set();
  const sources = Array.from(input.sources, source => {
    if (!keys(source, ['id', 'label', 'totalFrames']) || !safeId(source.id) || sourceIds.has(source.id) || !line(source.label, 40)
      || !integer(source.totalFrames, 1, MAX_FRAMES)) throw new Error('Sources need unique safe IDs, labels and integer totalFrames from one to 100000000.');
    sourceIds.add(source.id); return { ...source };
  }).sort((a, b) => order(a.id, b.id));
  const sourceById = new Map(sources.map(source => [source.id, source])), sceneIds = new Set();
  const scenes = Array.from(input.scenes, scene => {
    if (!keys(scene, ['id', 'label', 'takes']) || !safeId(scene.id) || sceneIds.has(scene.id) || !line(scene.label, 40)
      || !Array.isArray(scene.takes) || scene.takes.length < 2 || scene.takes.length > 3) throw new Error('Each ordered scene needs a unique safe ID, label and two or three named takes.');
    sceneIds.add(scene.id); const takeIds = new Set(), ranges = new Set();
    const takes = Array.from(scene.takes, take => {
      if (!keys(take, ['id', 'label', 'sourceId', 'sourceIn', 'sourceOut']) || !safeId(take.id) || takeIds.has(take.id) || !line(take.label, 26)
        || !sourceById.has(take.sourceId) || !integer(take.sourceIn, 0, MAX_FRAMES - 1) || !integer(take.sourceOut, 1, MAX_FRAMES)
        || take.sourceIn >= take.sourceOut || take.sourceOut > sourceById.get(take.sourceId).totalFrames) throw new Error('Takes need unique IDs, labels, a listed source and nonempty integer [sourceIn,sourceOut) bounds within that source.');
      const range = `${take.sourceId}:${take.sourceIn}:${take.sourceOut}`;
      if (ranges.has(range)) throw new Error('Two takes in one scene cannot name the same source range.');
      ranges.add(range); takeIds.add(take.id); return { ...take };
    });
    return { id: scene.id, label: scene.label, takes };
  });
  const result = { projectId: input.projectId, title: input.title, fps: input.fps, sources, scenes };
  if (scenes.some(scene => promptFor(result, scene).length > 500)) throw new Error('Take selection prompt exceeds 500 UTF-16 units.');
  return result;
}

export function validateConfig(config) {
  if (!keys(config, ['participant']) || !keys(config.participant, ['id', 'label']) || !isId(config.participant.id) || !line(config.participant.label, 60)) throw new Error('Config requires an exact editor UUID and label.');
  return structuredClone(config);
}
export const itemsFor = rawInput => validateInput(rawInput).scenes;
export function requestFor(rawInput, config, itemId, attemptId) {
  const input = validateInput(rawInput); validateConfig(config); const scene = input.scenes.find(item => item.id === itemId);
  if (!scene || !isId(attemptId)) throw new Error('Invalid scene or attempt.');
  const key = `edit-${attemptId}`;
  return { prompt: promptFor(input, scene), context: `To ${config.participant.id}`,
    options: [...scene.takes.map(take => ({ value: take.id, label: `${take.id}: ${take.label}`, style: 'default' })), { value: 'unknown', label: 'Unknown', style: 'default' }],
    responder_scope: 'direct', target_user_id: config.participant.id, ttl: TTL, correlation_id: key,
    data: { input_hash: hash(input), scene_hash: hash(scene), policy_hash: POLICY_HASH, item_id: scene.id, attempt_id: attemptId }, idempotencyKey: key };
}

/** Pure metadata calculation. CLI export also requires attributed Question evidence. */
export function buildTimeline(rawInput, selections) {
  const input = validateInput(rawInput);
  if (!keys(selections, input.scenes.map(scene => scene.id))) throw new Error('Supply exactly one selected take ID per scene.');
  let cursor = 0;
  const cuts = input.scenes.map((scene, index) => {
    const take = scene.takes.find(take => take.id === selections[scene.id]);
    if (!take) throw new Error('Every scene needs a known take belonging to that scene.');
    const durationFrames = take.sourceOut - take.sourceIn, timelineIn = cursor;
    cursor += durationFrames;
    if (!Number.isSafeInteger(cursor) || cursor > 8 * MAX_FRAMES) throw new Error('Timeline exceeds its bounded frame capacity.');
    return { index: index + 1, sceneId: scene.id, takeId: take.id, sourceId: take.sourceId, sourceIn: take.sourceIn, sourceOut: take.sourceOut,
      timelineIn, timelineOut: cursor, durationFrames };
  });
  return { format: 'pingroom-cut-list-v1', fps: input.fps, totalFrames: cursor, sources: input.sources, cuts,
    sourceHash: hash(input), policyHash: POLICY_HASH, mediaVerified: false, mediaRendered: false };
}

export function mapTimelineFrame(rawInput, selections, timelineFrame) {
  const timeline = buildTimeline(rawInput, selections);
  if (!integer(timelineFrame, 0, timeline.totalFrames - 1)) throw new Error('Timeline frame must be an integer inside [0,totalFrames).');
  const cut = timeline.cuts.find(cut => timelineFrame >= cut.timelineIn && timelineFrame < cut.timelineOut);
  return { sceneId: cut.sceneId, takeId: cut.takeId, sourceId: cut.sourceId, sourceFrame: cut.sourceIn + timelineFrame - cut.timelineIn };
}

export function editPlan(rawInput, answers) {
  const input = validateInput(rawInput);
  if (!Array.isArray(answers) || answers.length !== input.scenes.length || Array.from(answers).some((row, index) => !keys(row, ['sceneId', 'choice'])
    || row.sceneId !== input.scenes[index].id || ![null, 'unknown', ...input.scenes[index].takes.map(take => take.id)].includes(row.choice))) throw new Error('Supply one ordered take ID, Unknown or null choice per scene.');
  const missingSceneIds = answers.filter(row => row.choice === null).map(row => row.sceneId), unknownSceneIds = answers.filter(row => row.choice === 'unknown').map(row => row.sceneId);
  return { status: missingSceneIds.length ? 'incomplete' : unknownSceneIds.length ? 'unknown' : 'complete', missingSceneIds, unknownSceneIds,
    timeline: missingSceneIds.length || unknownSceneIds.length ? null : buildTimeline(input, Object.fromEntries(answers.map(row => [row.sceneId, row.choice]))) };
}

export function validateState(state, rawInput) {
  const input = validateInput(rawInput);
  if (!keys(state, ['version', 'inputHash', 'config', 'room', 'credentialHash', 'startedAt', 'attempts']) || state.version !== 1
    || state.inputHash !== hash(input) || typeof state.room !== 'string' || !ROOM.test(state.room)
    || typeof state.credentialHash !== 'string' || !/^[0-9a-f]{64}$(?![\s\S])/.test(state.credentialHash)
    || !Array.isArray(state.attempts) || state.attempts.length > itemsFor(input).length || iso(state.startedAt) !== state.startedAt) throw new Error('Invalid state or changed edit metadata. Restore the original input and configuration.');
  validateConfig(state.config);
  const items = itemsFor(input), ids = new Set(), questionIds = new Set(); let previous = state.startedAt, askerId;
  for (const [index, attempt] of state.attempts.entries()) {
    if (!keys(attempt, ['id', 'itemId', 'createdAt', 'request', 'questionId', 'status', 'observation']) || !isId(attempt.id) || ids.has(attempt.id)
      || attempt.itemId !== items[index].id || iso(attempt.createdAt) !== attempt.createdAt || attempt.createdAt < previous
      || hash(attempt.request) !== hash(requestFor(input, state.config, attempt.itemId, attempt.id))
      || !['creating', 'pending', 'answered', 'expired', 'cancelled', 'invalid_answer'].includes(attempt.status)) throw new Error('Invalid saved take selection or order.');
    ids.add(attempt.id); previous = attempt.createdAt;
    if (attempt.status === 'creating') {
      if (attempt.questionId !== null || attempt.observation !== null) throw new Error('Invalid uncertain creation state.');
    } else {
      if (!isId(attempt.questionId) || questionIds.has(attempt.questionId)) throw new Error('Invalid or repeated Question ID.');
      questionIds.add(attempt.questionId); validateObservation(attempt.observation, attempt.status, attempt.request);
      if (attempt.observation.checkedAt < attempt.createdAt) throw new Error('Observation predates its saved creation intent.');
      previous = attempt.observation.checkedAt;
      if (Date.parse(attempt.observation.createdAt) < Date.parse(attempt.createdAt) - CLOCK_SKEW_MS) throw new Error('Question predates its saved creation intent.');
      if (askerId !== undefined && attempt.observation.askerId !== askerId) throw new Error('Questions belong to different asking registrations.');
      askerId = attempt.observation.askerId;
    }
    if (['creating', 'pending'].includes(attempt.status) && index !== state.attempts.length - 1) throw new Error('Only the last confirmation may have an active Question.');
  }
  return state;
}




export function report(state, rawInput) {
  const input = validateInput(rawInput); validateState(state, input);
  const answers = input.scenes.map(scene => {
    const attempt = state.attempts.find(row => row.itemId === scene.id), answer = attempt?.observation?.answer;
    return { sceneId: scene.id, status: attempt?.status === 'creating' ? 'create_unknown' : attempt?.status ?? 'unasked',
      choice: answer?.value ?? null, label: answer?.label ?? null, questionId: attempt?.questionId ?? null, attemptId: attempt?.id ?? null,
      responderId: answer?.responderId ?? null, answeredAt: answer?.answeredAt ?? null, askerId: attempt?.observation?.askerId ?? null, observedAt: attempt?.observation?.checkedAt ?? null };
  });
  const calculation = editPlan(input, answers.map(({ sceneId, choice }) => ({ sceneId, choice })));
  const active = answers.find(row => ['create_unknown', 'pending'].includes(row.status));
  const status = active?.status ?? (answers.some(row => row.status === 'unasked') ? 'ready' : calculation.status);
  return { version: 1, projectId: input.projectId, sourceHash: hash(input), source: input, policy: POLICY, policyHash: POLICY_HASH,
    participant: state.config.participant, room: state.room, configHash: hash(state.config), answers, ...calculation, status };
}

function validateObservation(observation, status, request) {
  if (!keys(observation, ['createdAt', 'expiresAt', 'checkedAt', 'askerId', 'resolvedAt', 'answer']) || !isId(observation.askerId)) throw new Error('Invalid saved observation.');
  for (const key of ['createdAt', 'expiresAt', 'checkedAt']) if (iso(observation[key]) !== observation[key]) throw new Error('Invalid saved timestamp.');
  const duration = Date.parse(observation.expiresAt) - Date.parse(observation.createdAt);
  if (duration < TTL * 1000 - 1000 || duration > TTL * 1000 + 1000) throw new Error('Question lifetime differs from the saved request.');
  const latest = Date.parse(observation.checkedAt) + CLOCK_SKEW_MS;
  if (Date.parse(observation.createdAt) > latest) throw new Error('Question creation is implausibly in the future. Check the local clock.');
  if (status === 'pending') {
    if (observation.resolvedAt !== null) throw new Error('Pending Question has a resolution timestamp.');
  } else if (iso(observation.resolvedAt) !== observation.resolvedAt || observation.resolvedAt < observation.createdAt
    || Date.parse(observation.resolvedAt) > latest
    || (status === 'expired' ? observation.resolvedAt < observation.expiresAt : observation.resolvedAt > observation.expiresAt)) throw new Error('Invalid Question resolution time.');
  if (status === 'answered') {
    const answer = observation.answer;
    if (!keys(answer, ['value', 'label', 'responderId', 'answeredAt']) || answer.responderId !== request.target_user_id
      || !request.options.some((option) => option.value === answer.value && option.label === answer.label)
      || iso(answer.answeredAt) !== answer.answeredAt || answer.answeredAt !== observation.resolvedAt
      || answer.answeredAt < observation.createdAt || answer.answeredAt > observation.expiresAt) throw new Error('Invalid saved take selection evidence.');
  } else if (observation.answer !== null) throw new Error('Unanswered take selections must not contain take selection evidence.');
}

export function observeQuestion(q, request, questionId, room, checkedAt) {
  if (!isId(questionId) || q?.id !== questionId || q.kind !== 'question' || (q.is_handoff !== undefined && q.is_handoff !== false)
    || q.asker?.type !== 'agent' || !isId(q.asker?.id) || q.prompt !== request.prompt || q.context !== request.context
    || q.responder_scope !== 'direct' || q.target_user_id !== request.target_user_id || q.resolution_policy !== 'first'
    || (q.results !== undefined && q.results !== null) || q.text_input !== null || q.correlation_id !== request.correlation_id || q.reply_to !== null || hash(q.data) !== hash(request.data)
    || (q.room_code ?? q.room?.code) !== room || q.room_code !== undefined && q.room_code !== room
    || q.room !== undefined && q.room?.code !== room || !['pending', 'answered', 'expired', 'cancelled'].includes(q.state)
    || !Array.isArray(q.options) || q.options.length !== request.options.length
    || Array.from(q.options).some((option, index) => option?.value !== request.options[index].value || option?.label !== request.options[index].label
      || (option?.primary !== undefined && option.primary !== false) || (option?.destructive !== undefined && option.destructive !== false))) throw new Error('Question does not match the saved configuration, room, or reviewer.');
  const observation = { createdAt: iso(q.created_at), expiresAt: iso(q.expires_at), checkedAt: iso(checkedAt), askerId: q.asker.id,
    resolvedAt: q.resolved_at === null ? null : iso(q.resolved_at), answer: null };
  let status = q.state === 'answered' ? 'invalid_answer' : q.state;
  if (q.state !== 'answered' && q.answer !== null) throw new Error('Unresolved Question includes an unexpected answer.');
  if (q.state === 'answered') {
    const answer = q.answer;
    try {
      if (!answer || answer.text !== null || answer.responder?.id !== request.target_user_id
        || !request.options.some((option) => option.value === answer.value && option.label === answer.label)) throw new Error('Invalid answer.');
      observation.answer = { value: answer.value, label: answer.label, responderId: answer.responder.id, answeredAt: iso(answer.answered_at) };
      validateObservation(observation, 'answered', request); status = 'answered';
    } catch { observation.answer = null; }
  }
  validateObservation(observation, status, request);
  return { status, observation };
}

export function assertParticipantRoom(rooms, room, participantId) {
  if (!Array.isArray(rooms) || rooms.length > 1000) throw new Error('Invalid room inventory.');
  const matches = rooms.filter((item) => item?.invite_code === room), selected = matches[0];
  if (matches.length !== 1 || selected.type !== 'standard' || selected.is_public !== false || !Array.isArray(selected.members)
    || selected.members.length > 1000 || !selected.members.some((member) => member?.user_id === participantId)) throw new Error('Use a granted standard private room containing the named participant.');
}
