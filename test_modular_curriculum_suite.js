// test_modular_curriculum_suite.js
// Deterministic verification test suite for Modular Curriculum & Skills Library in TutorPilot

const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== RUNNING MODULAR CURRICULUM TEST SUITE ===');

const indexPath = path.resolve(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

// Extract the main application script block
const mainScript = indexHtml.slice(indexHtml.lastIndexOf('<script>') + 8, indexHtml.lastIndexOf('</script>'));

const mockLocalStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; }
};

const domElements = {};
function getOrCreateElem(id) {
  if (!domElements[id]) {
    domElements[id] = {
      id,
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
      },
      innerHTML: '',
      textContent: '',
      value: '',
      style: {},
      hasChildNodes() { return !!this.innerHTML; },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      removeAttribute(k) { delete this[k]; },
      addEventListener() {},
      focus() {},
      blur() {},
      reset() {}
    };
  }
  return domElements[id];
}

const sandbox = {
  console,
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  tailwind: { config: {} },
  lucide: { createIcons() {} },
  localStorage: mockLocalStorage,
  confirm: () => true,
  alert: () => {},
  prompt: () => '',
  scrollTo: () => {},
  window: {
    location: { href: 'https://tutorpilot.pages.dev', pathname: '/', hash: '', search: '' },
    _listeners: {},
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    },
    dispatchEvent(event) {
      const list = this._listeners[event.type] || [];
      list.forEach(fn => fn(event));
    },
    lucide: { createIcons() {} },
    confirm: () => true,
    alert: () => {},
    prompt: () => '',
    scrollTo: () => {}
  },
  document: {
    documentElement: { setAttribute() {} },
    getElementById: getOrCreateElem,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    activeElement: null
  },
  navigator: {
    clipboard: { writeText: () => Promise.resolve() },
    language: 'en-US'
  },
  location: { href: 'https://bar-mitzvah-tutor.pages.dev' },
  showToast: () => {},
  escapeHtml: s => String(s || ''),
  atob: b64 => Buffer.from(b64, 'base64').toString('utf8')
};

vm.createContext(sandbox);

try {
  const topicsScript = fs.readFileSync(path.resolve(__dirname, 'src/jewish_topics_data.js'), 'utf8');
  const bereishitScript = fs.readFileSync(path.resolve(__dirname, 'src/chumash_bereishit_data.js'), 'utf8');
  const shemotScript = fs.readFileSync(path.resolve(__dirname, 'src/chumash_shemot_data.js'), 'utf8');

  vm.runInContext(topicsScript, sandbox);
  vm.runInContext(bereishitScript, sandbox);
  vm.runInContext(shemotScript, sandbox);

  vm.runInContext(mainScript, sandbox);
  sandbox.APP_STATE = sandbox.window.APP_STATE;
  sandbox.DEFAULT_SCHOOL = sandbox.window.DEFAULT_SCHOOL;
  sandbox.I18N = sandbox.window.I18N;
  console.log('✓ Successfully compiled and loaded application scripts into VM');
} catch (err) {
  console.error('Script loading error:', err);
  process.exit(1);
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    passedTests++;
    console.log(`✓ PASS: ${message}`);
  }
}

// Gate 1: Check DOM containers in index.html
console.log('\n--- Gate 1: HTML Category Navigation Containers ---');
assert(indexHtml.includes('btn-study-cat-lessons'), 'HTML contains Lessons category tab button');
assert(indexHtml.includes('btn-study-cat-reading'), 'HTML contains Reading category tab button');
assert(indexHtml.includes('btn-study-cat-speech'), 'HTML contains Speech category tab button');
assert(indexHtml.includes('btn-study-cat-custom'), 'HTML contains Custom category tab button');
assert(indexHtml.includes('study-category-lessons'), 'HTML contains study-category-lessons container');
assert(indexHtml.includes('study-category-reading'), 'HTML contains study-category-reading container');
assert(indexHtml.includes('study-category-speech'), 'HTML contains study-category-speech container');
assert(indexHtml.includes('study-category-custom'), 'HTML contains study-category-custom container');

// Gate 2: ensureStudentSkills initializes enrolledModules with 100% backward compatibility
console.log('\n--- Gate 2: Enrolled Modules Backward Compatibility ---');
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
const dummyStudent = { id: 'std_test_1', name: 'Benny Cohen' };
sandbox.ensureStudentSkills(dummyStudent);
assert(dummyStudent.enrolledModules !== undefined, 'enrolledModules object exists on student');
assert(dummyStudent.enrolledModules.lessons === true, 'enrolledModules.lessons defaults to true');
assert(dummyStudent.enrolledModules.reading === true, 'enrolledModules.reading defaults to true');
assert(dummyStudent.enrolledModules.speech === true, 'enrolledModules.speech defaults to true');
assert(dummyStudent.enrolledModules.custom === true, 'enrolledModules.custom defaults to true');

// Verify external tutor default enrollment omits Bar Mitzvah specific modules
sandbox.APP_STATE.currentUser = { email: 'math_teacher@school.edu' };
const externalStudent = { id: 'std_ext_1', name: 'Alice Smith' };
sandbox.ensureStudentSkills(externalStudent);
assert(externalStudent.enrolledModules.lessons === true, 'External student has lessons enabled');
assert(externalStudent.enrolledModules.reading === false, 'External student has Hebrew reading disabled by default');
assert(externalStudent.enrolledModules.speech === false, 'External student has Bar Mitzvah speech disabled by default');
assert(externalStudent.enrolledModules.custom === true, 'External student has custom enabled');

// Gate 3: Permanent Goals & Homework Invariants
console.log('\n--- Gate 3: Permanent Goals & Homework Invariants ---');
assert(dummyStudent.skills.homework !== undefined, 'Student has homework structure');
assert(Array.isArray(dummyStudent.skills.customGoals), 'Student has customGoals array');

// Gate 4: Toggle Student Module
console.log('\n--- Gate 4: Toggle Student Module Functionality ---');
sandbox.APP_STATE.students = [dummyStudent];
assert(typeof sandbox.toggleStudentModule === 'function', 'toggleStudentModule is a function');
sandbox.toggleStudentModule('std_test_1', 'reading');
assert(dummyStudent.enrolledModules.reading === false, 'toggleStudentModule successfully disabled reading');
sandbox.toggleStudentModule('std_test_1', 'reading');
assert(dummyStudent.enrolledModules.reading === true, 'toggleStudentModule successfully re-enabled reading');

// Gate 5: Study Category Switcher
console.log('\n--- Gate 5: Study Category Switcher ---');
assert(typeof sandbox.switchStudyCategory === 'function', 'switchStudyCategory is a function');
sandbox.switchStudyCategory('reading');
assert(sandbox.APP_STATE.activeStudyCategory === 'reading', 'activeStudyCategory switched to reading');
sandbox.switchStudyCategory('speech');
assert(sandbox.APP_STATE.activeStudyCategory === 'speech', 'activeStudyCategory switched to speech');
sandbox.switchStudyCategory('custom');
assert(sandbox.APP_STATE.activeStudyCategory === 'custom', 'activeStudyCategory switched to custom');
sandbox.switchStudyCategory('lessons');
assert(sandbox.APP_STATE.activeStudyCategory === 'lessons', 'activeStudyCategory switched back to lessons');

// Gate 6: Multi-Tenant Isolation & isMasterAccount Invariants
console.log('\n--- Gate 6: Multi-Tenant Isolation & Account Scoping ---');
assert(typeof sandbox.isMasterAccount === 'function', 'isMasterAccount is a function');

// Test master accounts
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
assert(sandbox.isMasterAccount() === true, 'shmueldoviduhlman@gmail.com is identified as master account');

sandbox.APP_STATE.currentUser = { email: 'coteacher@school.org', school_id: 'school_main_770' };
assert(sandbox.isMasterAccount() === true, 'coteacher in school_main_770 is identified as master account');

sandbox.APP_STATE.currentUser = { email: 'admin@tutors.org', role: 'super_admin' };
assert(sandbox.isMasterAccount() === true, 'super_admin role is identified as master account');

// Test external tutor accounts
sandbox.APP_STATE.currentUser = { email: 'math_teacher@school.edu', role: 'authenticated' };
assert(sandbox.isMasterAccount() === false, 'External tutor is NOT identified as master account');

sandbox.APP_STATE.currentUser = null;
assert(sandbox.isMasterAccount() === false, 'Unauthenticated user is NOT identified as master account');
assert(sandbox.getActiveSchoolId() === null, 'Unauthenticated user has null active school ID');
assert(sandbox.getStudentStorageKey() === 'tutor_students_unauthenticated', 'Unauthenticated student storage key is isolated');
assert(sandbox.getCustomCoursesStorageKey() === 'tutor_custom_courses_unauthenticated', 'Unauthenticated courses storage key is isolated');
assert(sandbox.getStudyMaterialsStorageKey() === 'tutor_study_additions_unauthenticated', 'Unauthenticated materials storage key is isolated');
assert(sandbox.getCustomReadingStorageKey() === 'tutor_custom_reading_unauthenticated', 'Unauthenticated reading storage key is isolated');
assert(sandbox.getCustomMilestonesStorageKey() === 'tutor_custom_milestones_unauthenticated', 'Unauthenticated milestones storage key is isolated');

// Verify public signup form does not leak private join code
assert(!indexHtml.includes('e.g. 770770'), 'Signup form does NOT expose 770770 join code example');
assert(!indexHtml.includes('לדוגמה: 770770'), 'Hebrew signup form does NOT expose 770770 join code example');

// Test storage key scoping
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
assert(sandbox.getCustomCoursesStorageKey() === 'tutor_custom_courses', 'Master courses storage key is unscoped');
assert(sandbox.getStudyMaterialsStorageKey() === 'tutor_study_additions', 'Master materials storage key is unscoped');

sandbox.APP_STATE.currentUser = { email: 'math_teacher@school.edu' };
assert(sandbox.getCustomCoursesStorageKey() === 'tutor_custom_courses_math_teacher_school_edu', 'External courses storage key is scoped');
assert(sandbox.getStudyMaterialsStorageKey() === 'tutor_study_additions_math_teacher_school_edu', 'External materials storage key is scoped');

// Option A: External tutor starts with empty courses and blank state
sandbox.APP_STATE.currentUser = { email: 'math_teacher@school.edu' };
sandbox.APP_STATE.customCourses = [];
sandbox.populateCourseSelector();
const extSelectHtml = getOrCreateElem('study-course-select').innerHTML;
assert(!extSelectHtml.includes('course_bar_mitzvah_concepts') && !extSelectHtml.includes('course_bar_mitzvah_chumash'), 'External course selector omits Bar Mitzvah courses');
assert(extSelectHtml.includes('No courses created yet'), 'External course selector shows empty state placeholder');

sandbox.renderLessonsCategoryView();
const tutorBlank = getOrCreateElem('tutor-hub-blank-state');
const tutorActive = getOrCreateElem('tutor-hub-active-lessons');
assert(!tutorBlank.classList.contains('hidden'), 'External user with zero courses sees blank state');
assert(tutorActive.classList.contains('hidden'), 'External user with zero courses has active lessons hidden');

// Option A: Master user account seeding
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
assert(typeof sandbox.seedBarMitzvahCoursesToAccount === 'function', 'seedBarMitzvahCoursesToAccount is a function');
sandbox.seedBarMitzvahCoursesToAccount(true);

assert(sandbox.APP_STATE.customCourses.some(c => c.id === 'course_bar_mitzvah_concepts'), 'Master account has 13 Jewish Concepts seeded into customCourses');
assert(sandbox.APP_STATE.customCourses.some(c => c.id === 'course_bar_mitzvah_chumash'), 'Master account has 23 Chumash Parshiot seeded into customCourses');

const conceptsCourse = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_bar_mitzvah_concepts');
assert(conceptsCourse && conceptsCourse.lessons.length === 13, 'Seeded Jewish Concepts course contains exactly 13 lessons');
const chumashCourse = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_bar_mitzvah_chumash');
assert(chumashCourse && chumashCourse.lessons.length === 23, 'Seeded Chumash course contains exactly 23 lessons');

// Test Course Selector for Master with Seeded Courses
sandbox.populateCourseSelector();
const masterSelectHtml = getOrCreateElem('study-course-select').innerHTML;
assert(masterSelectHtml.includes('course_bar_mitzvah_concepts') && masterSelectHtml.includes('course_bar_mitzvah_chumash'), 'Master course selector includes seeded Concepts and Chumash');

// Test Lessons Category View for Master with Seeded Courses
sandbox.APP_STATE.activeCourseId = 'course_bar_mitzvah_concepts';
sandbox.renderLessonsCategoryView();
assert(tutorBlank.classList.contains('hidden'), 'Master account with seeded courses has blank state hidden');
assert(!tutorActive.classList.contains('hidden'), 'Master account with seeded courses has active lessons unhidden');
const activeLessonsHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
assert(activeLessonsHtml.includes('Shabbat') && activeLessonsHtml.includes('Tefillin'), 'Active lessons container renders seeded Bar Mitzvah lessons');

// Gate 7: Reading & Speech Multi-Tenant Isolation (Option A)
console.log('\n--- Gate 7: Reading & Speech Multi-Tenant Isolation ---');
assert(typeof sandbox.getCustomReadingStorageKey === 'function', 'getCustomReadingStorageKey is a function');
assert(typeof sandbox.getCustomMilestonesStorageKey === 'function', 'getCustomMilestonesStorageKey is a function');

// Test reading & milestone storage key scoping
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
assert(sandbox.getCustomReadingStorageKey() === 'tutor_custom_reading', 'Master reading storage key is unscoped');
assert(sandbox.getCustomMilestonesStorageKey() === 'tutor_custom_milestones', 'Master milestones storage key is unscoped');

sandbox.APP_STATE.currentUser = { email: 'science_tutor@academy.org' };
assert(sandbox.getCustomReadingStorageKey() === 'tutor_custom_reading_science_tutor_academy_org', 'External reading storage key is scoped');
assert(sandbox.getCustomMilestonesStorageKey() === 'tutor_custom_milestones_science_tutor_academy_org', 'External milestones storage key is scoped');

// Test Reading View Isolation
// External Tutor with zero reading units
sandbox.APP_STATE.currentUser = { email: 'science_tutor@academy.org' };
sandbox.APP_STATE.customReadingMaterials = [];
sandbox.renderReadingCategoryView();
const tutorReadingBlank = getOrCreateElem('tutor-reading-blank-state');
const tutorReadingActive = getOrCreateElem('tutor-reading-active-container');
assert(!tutorReadingBlank.classList.contains('hidden'), 'External tutor with 0 reading units sees blank state');
assert(tutorReadingActive.classList.contains('hidden'), 'External tutor with 0 reading units has active container hidden');

// Master Account with seeded reading units
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
sandbox.seedBarMitzvahCoursesToAccount(true);
assert(Array.isArray(sandbox.APP_STATE.customReadingMaterials) && sandbox.APP_STATE.customReadingMaterials.length === 4, 'Master account has 4 leveled reading units seeded');
sandbox.renderReadingCategoryView();
assert(tutorReadingBlank.classList.contains('hidden'), 'Master account with seeded reading units has blank state hidden');
assert(!tutorReadingActive.classList.contains('hidden'), 'Master account with seeded reading units has active container unhidden');
const readingGridHtml = getOrCreateElem('tutor-reading-units-grid').innerHTML;
assert(readingGridHtml.includes('Red Booklet') || readingGridHtml.includes('חוברת אדומה') || readingGridHtml.includes('bm_reading_red'), 'Reading units grid renders seeded booklets');

// Test Speech View Isolation
// External Tutor with zero milestones
sandbox.APP_STATE.currentUser = { email: 'science_tutor@academy.org' };
sandbox.APP_STATE.customMilestones = [];
sandbox.renderSpeechCategoryView();
const tutorSpeechBlank = getOrCreateElem('tutor-speech-blank-state');
const tutorSpeechActive = getOrCreateElem('tutor-speech-active-container');
assert(!tutorSpeechBlank.classList.contains('hidden'), 'External tutor with 0 milestones sees blank state');
assert(tutorSpeechActive.classList.contains('hidden'), 'External tutor with 0 milestones has active container hidden');

// Master Account with seeded milestones
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
sandbox.seedBarMitzvahCoursesToAccount(true);
assert(Array.isArray(sandbox.APP_STATE.customMilestones) && sandbox.APP_STATE.customMilestones.length === 5, 'Master account has 5 speech stages seeded');
sandbox.renderSpeechCategoryView();
assert(tutorSpeechBlank.classList.contains('hidden'), 'Master account with seeded milestones has blank state hidden');
assert(!tutorSpeechActive.classList.contains('hidden'), 'Master account with seeded milestones has active container unhidden');
const speechGridHtml = getOrCreateElem('tutor-milestones-grid').innerHTML;
assert(speechGridHtml.includes('Stage 1') || speechGridHtml.includes('שלב 1') || speechGridHtml.includes('bm_stage_1'), 'Milestones grid renders seeded speech stages');

// Gate 8: Authoring Modals & Student Drawer Synchronization
console.log('\n--- Gate 8: Authoring Modals & Student Drawer Synchronization ---');
assert(indexHtml.includes('modal-create-course'), 'HTML contains modal-create-course');
assert(indexHtml.includes('modal-add-custom-lesson'), 'HTML contains modal-add-custom-lesson');
assert(indexHtml.includes('modal-add-custom-reading'), 'HTML contains modal-add-custom-reading');
assert(indexHtml.includes('modal-ai-reading-builder'), 'HTML contains modal-ai-reading-builder');
assert(indexHtml.includes('modal-add-custom-milestone'), 'HTML contains modal-add-custom-milestone');
assert(indexHtml.includes('modal-ai-milestone-builder'), 'HTML contains modal-ai-milestone-builder');

assert(typeof sandbox.openCreateCourseModal === 'function', 'openCreateCourseModal is a function');
assert(typeof sandbox.handleSaveCustomCourse === 'function', 'handleSaveCustomCourse is a function');
assert(typeof sandbox.handleDeleteActiveCustomCourse === 'function', 'handleDeleteActiveCustomCourse is a function');
assert(typeof sandbox.openAddCustomLessonModal === 'function', 'openAddCustomLessonModal is a function');
assert(typeof sandbox.openEditCustomLessonModal === 'function', 'openEditCustomLessonModal is a function');
assert(typeof sandbox.handleSaveCustomLesson === 'function', 'handleSaveCustomLesson is a function');
assert(typeof sandbox.handleDeleteCustomLesson === 'function', 'handleDeleteCustomLesson is a function');

assert(typeof sandbox.openAddCustomReadingModal === 'function', 'openAddCustomReadingModal is a function');
assert(typeof sandbox.openAiReadingBuilderModal === 'function', 'openAiReadingBuilderModal is a function');
assert(typeof sandbox.openAddCustomMilestoneModal === 'function', 'openAddCustomMilestoneModal is a function');
assert(typeof sandbox.openAiMilestoneBuilderModal === 'function', 'openAiMilestoneBuilderModal is a function');

// Test active units rendering when external tutor has content
sandbox.APP_STATE.currentUser = { email: 'science_tutor@academy.org' };
sandbox.APP_STATE.customReadingMaterials = [
  { id: 'unit_1', title: 'Level 1: Phonics', badge: 'Level 1', color: 'red', description: 'CVC words', targets: ['cat', 'bat'] }
];
sandbox.renderReadingCategoryView();
assert(tutorReadingBlank.classList.contains('hidden'), 'External tutor with reading units hides blank state');

sandbox.APP_STATE.customMilestones = [
  { id: 'stage_1', stage_num: 1, title: 'Stage 1: Outline', guidance: 'Thesis and outline', deliverables: ['Draft'] }
];
sandbox.renderSpeechCategoryView();
assert(tutorSpeechBlank.classList.contains('hidden'), 'External tutor with milestones hides blank state');

// Test student drawer custom cards
const testExtStudent = {
  id: 'std_ext_test',
  name: 'Sam Wilson',
  enrolledModules: { lessons: true, reading: true, speech: true, custom: true },
  skills: { customReading: { levelId: 'unit_1' }, customSpeech: { topic: 'Mars Rover' } }
};
const customReadingCardHtml = sandbox.renderStudentCustomReadingCard(testExtStudent);
assert(customReadingCardHtml.includes('Level 1: Phonics') || customReadingCardHtml.includes('Level 1'), 'Custom reading card renders tutor level badge');

const customSpeechCardHtml = sandbox.renderStudentCustomSpeechCard(testExtStudent);
assert(customSpeechCardHtml.includes('Mars Rover') || customSpeechCardHtml.includes('Stage 1: Outline'), 'Custom speech card renders tutor topic and stages');

// Gate 9: Course & Lesson Authoring and Sound / Audio Studio
console.log('\n--- Gate 9: Course & Lesson Studio and Sound / Audio Studio ---');
assert(indexHtml.includes('voice-recording-hud'), 'HTML contains voice-recording-hud');
assert(indexHtml.includes('voice-recording-timer'), 'HTML contains voice-recording-timer');
assert(indexHtml.includes('lesson-audio-file-input'), 'HTML contains lesson-audio-file-input');
assert(indexHtml.includes('reading-audio-file-input'), 'HTML contains reading-audio-file-input');

assert(typeof sandbox.startVoiceRecording === 'function', 'startVoiceRecording is a function');
assert(typeof sandbox.stopVoiceRecording === 'function', 'stopVoiceRecording is a function');
assert(typeof sandbox.cancelVoiceRecording === 'function', 'cancelVoiceRecording is a function');
assert(typeof sandbox.saveRecordedAudioToTarget === 'function', 'saveRecordedAudioToTarget is a function');

assert(typeof sandbox.triggerLessonAudioUpload === 'function', 'triggerLessonAudioUpload is a function');
assert(typeof sandbox.handleLessonAudioFileSelected === 'function', 'handleLessonAudioFileSelected is a function');
assert(typeof sandbox.promptLessonAudioLink === 'function', 'promptLessonAudioLink is a function');
assert(typeof sandbox.deleteLessonAudio === 'function', 'deleteLessonAudio is a function');

assert(typeof sandbox.triggerReadingAudioUpload === 'function', 'triggerReadingAudioUpload is a function');
assert(typeof sandbox.handleReadingAudioFileSelected === 'function', 'handleReadingAudioFileSelected is a function');
assert(typeof sandbox.promptReadingAudioLink === 'function', 'promptReadingAudioLink is a function');
assert(typeof sandbox.deleteReadingAudio === 'function', 'deleteReadingAudio is a function');

// Test Course Creation execution
getOrCreateElem('input-create-course-title-en').value = 'Mishnah Berurah';
getOrCreateElem('input-create-course-title-he').value = 'משנה ברורה';
getOrCreateElem('input-create-course-category').value = 'Halachah';
getOrCreateElem('input-create-course-level').value = 'High School';
getOrCreateElem('input-create-course-desc').value = 'Laws of daily conduct';
getOrCreateElem('input-create-course-icon').value = '📖';

const initialCourseCount = sandbox.APP_STATE.customCourses.length;
sandbox.handleSaveCustomCourse({ preventDefault() {} });
assert(sandbox.APP_STATE.customCourses.length === initialCourseCount + 1, 'handleSaveCustomCourse successfully created and appended a new course');
const createdCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Mishnah Berurah');
assert(createdCourse !== undefined, 'Created course found in APP_STATE.customCourses');
assert(sandbox.APP_STATE.activeCourseId === createdCourse.id, 'Created course is set as activeCourseId');

// Test Lesson Creation execution on the new course
getOrCreateElem('input-custom-lesson-title-en').value = 'Siman 1: Awakening in the Morning';
getOrCreateElem('input-custom-lesson-title-he').value = 'סימן א: השכמת הבוקר';
getOrCreateElem('input-custom-lesson-hook').value = 'How you start your day sets the tone for your entire life.';
getOrCreateElem('input-custom-lesson-anchors').value = 'Be strong as a lion\nModeh Ani upon waking\nHand washing';
getOrCreateElem('input-custom-lesson-life-app').value = 'Discipline beats motivation every single morning.';
getOrCreateElem('input-custom-lesson-discussion').value = 'Why is the lion chosen as the symbol for waking up?';

sandbox.handleSaveCustomLesson({ preventDefault() {} });
assert(createdCourse.lessons.length === 1, 'handleSaveCustomLesson successfully added a lesson to the course');
const createdLesson = createdCourse.lessons[0];
assert(createdLesson.title_en === 'Siman 1: Awakening in the Morning', 'Lesson title matches input');

// Test Audio Attachment via saveRecordedAudioToTarget
sandbox.saveRecordedAudioToTarget(
  { type: 'lesson', courseId: createdCourse.id, targetId: createdLesson.id },
  'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=',
  'Voice Memo - Siman 1 Overview'
);
assert(Array.isArray(createdLesson.recordings) && createdLesson.recordings.length === 1, 'Audio recording successfully attached to lesson');
assert(createdLesson.recordings[0].title === 'Voice Memo - Siman 1 Overview', 'Attached audio title matches');

// Test Audio player rendering in expanded lesson / edit lesson view
if (!sandbox.APP_STATE.expandedCustomLessonIds) sandbox.APP_STATE.expandedCustomLessonIds = {};
sandbox.APP_STATE.expandedCustomLessonIds[createdLesson.id] = true;
sandbox.enterStudioEditLessonMode(createdCourse.id, createdLesson.id);
const activeLessonsHtmlAfterAudio = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
assert(activeLessonsHtmlAfterAudio.includes('<audio controls') || activeLessonsHtmlAfterAudio.includes('audio/webm'), 'Expanded lesson renders HTML5 audio player');
assert(activeLessonsHtmlAfterAudio.includes('Voice Memo - Siman 1 Overview'), 'Expanded lesson renders audio recording title');
assert(activeLessonsHtmlAfterAudio.includes('Record Voice Memo'), 'Expanded lesson renders Record Voice Memo button');

// Test Audio Deletion
sandbox.deleteLessonAudio(createdCourse.id, createdLesson.id, createdLesson.recordings[0].id);
assert(createdLesson.recordings.length === 0, 'deleteLessonAudio successfully removed recording');

// Gate 10: Conversational AI Lesson & Course Studio and Connected Pedagogy
console.log('\n--- Gate 10: AI Conversational Studio & Connected Curriculum ---');
assert(indexHtml.includes('form-ai-single-lesson-builder'), 'HTML contains form-ai-single-lesson-builder');
assert(indexHtml.includes('tab-btn-ai-builder-full'), 'HTML contains tab-btn-ai-builder-full');
assert(indexHtml.includes('tab-btn-ai-builder-single'), 'HTML contains tab-btn-ai-builder-single');

assert(typeof sandbox.switchAiBuilderTab === 'function', 'switchAiBuilderTab is a function');
assert(typeof sandbox.populateAiSingleLessonCourseSelect === 'function', 'populateAiSingleLessonCourseSelect is a function');
assert(typeof sandbox.updateAiSingleLessonConnectOptions === 'function', 'updateAiSingleLessonConnectOptions is a function');
assert(typeof sandbox.handleGenerateSingleLesson === 'function', 'handleGenerateSingleLesson is a function');
assert(typeof sandbox.navigateToCourse === 'function', 'navigateToCourse is a function');
assert(typeof sandbox.navigateToLesson === 'function', 'navigateToLesson is a function');

// Assert tools in buildGeminiToolsDeclaration
const toolsDecl = sandbox.buildGeminiToolsDeclaration();
assert(Array.isArray(toolsDecl) && toolsDecl.length > 0, 'buildGeminiToolsDeclaration returns tools array');
const funcList = toolsDecl[0].functionDeclarations || [];
const toolNames = funcList.map(f => f.name);
assert(toolNames.includes('create_lesson'), 'buildGeminiToolsDeclaration includes create_lesson');
assert(toolNames.includes('create_course'), 'buildGeminiToolsDeclaration includes create_course');
assert(toolNames.includes('create_full_class'), 'buildGeminiToolsDeclaration includes create_full_class');

// Test executeAiToolCall with create_course
const createCourseResult = sandbox.executeAiToolCall({
  name: 'create_course',
  args: {
    title_en: 'Chassidic Philosophy & Ethics',
    title_he: 'תורת החסידות ומוסר',
    category: 'Philosophy',
    target_level: 'Bar Mitzvah & Teens',
    description_en: 'Foundational concepts of Tanya and Chassidus',
    icon: '🔥'
  }
});
assert(createCourseResult.success === true, 'executeAiToolCall create_course succeeded');
assert(createCourseResult.courseId !== undefined, 'create_course returned courseId');
assert(createCourseResult.createdCourse !== undefined, 'create_course returned createdCourse payload');
const chassidusCourse = sandbox.APP_STATE.customCourses.find(c => c.id === createCourseResult.courseId);
assert(chassidusCourse !== undefined, 'Newly created course exists in customCourses');
assert(chassidusCourse.icon === '🔥', 'Newly created course retained custom icon');

// Test executeAiToolCall with create_lesson
const createLessonResult = sandbox.executeAiToolCall({
  name: 'create_lesson',
  args: {
    courseIdOrName: chassidusCourse.id,
    title_en: 'The Divine Soul: Finding Your Inner Superpower',
    title_he: 'הנפש האלוהית: מציאת הכוח הפנימי',
    hook_en: 'Have you ever felt an inner battle between what is easy and what is truly right?',
    hook_he: 'האם הרגשת פעם מאבק פנימי בין מה שקל לבין מה שנכון באמת?',
    anchors_en: [
      '**Two Souls**: Every person has a natural soul and a divine soul.',
      '**Mind Over Heart**: The intellect has the natural power to guide emotions.',
      '**Continuous Growth**: A Beinoni is not mediocre, but an active champion of choices.',
      '**Action First**: Small good deeds create massive ripples in the universe.'
    ],
    anchors_he: [
      '**שתי נפשות**: בכל אדם פועלות נפש טבעית ונפש אלוהית.',
      '**מוח שליט על הלב**: לשכל יש את הכוח להדריך את הרגש.'
    ],
    midrash_en: 'The Tanya explains that an entire candle is illuminated by a single flame.',
    midrash_he: 'מעט אור דוחה הרבה מן החושך.',
    life_app_en: 'When feeling tempted to react angrily, pause for 5 seconds to let your mind steer your words.',
    life_app_he: 'ברגע של כעס, עצור לחמש שניות ותן לשכל להוביל את התגובה.',
    discussion_en: 'Can someone be a good person even if they constantly struggle with negative thoughts?',
    discussion_he: 'האם אדם נחשב לצדיק במעשיו גם אם מחשבותיו מאתגרות אותו ללא הרף?'
  }
});
assert(createLessonResult.success === true, 'executeAiToolCall create_lesson succeeded');
assert(createLessonResult.lessonId !== undefined, 'create_lesson returned lessonId');
assert(createLessonResult.createdLesson !== undefined, 'create_lesson returned createdLesson object');
const chassidusLesson = chassidusCourse.lessons.find(l => l.id === createLessonResult.lessonId);
assert(chassidusLesson !== undefined, 'Created lesson is attached to chassidusCourse');
assert(chassidusLesson.anchors_en.length === 4, 'Lesson has 4 formatted anchors');
assert(chassidusLesson.anchors_en[0].includes('**Two Souls**'), 'Anchors format bold keyword correctly');
assert(chassidusLesson.life_app_en.includes('5 seconds'), 'Lesson includes teen life application');

// Test executeAiToolCall with create_full_class
const createFullClassResult = sandbox.executeAiToolCall({
  name: 'create_full_class',
  args: {
    course_title_en: 'Tefillin Masterclass',
    course_title_he: 'אמנות הנחת תפילין',
    category: 'Mitzvot',
    target_level: 'Grade 7-8',
    icon: '📦',
    lessons: [
      {
        title_en: 'The Anatomy of Tefillin',
        title_he: 'מבנה התפילין והקלף',
        hook_en: 'Why do Tefillin need to be jet black and mathematically square?',
        anchors_en: ['**Halacha LeMoshe MiSinai**: The square boxes and black straps date back to Sinai.']
      },
      {
        title_en: 'Head and Heart Alignment',
        title_he: 'חיבור ראש ולב',
        hook_en: 'Why wrap the arm before the head?',
        anchors_en: ['**Subjugating Action**: We place dedication on the arm opposite the heart first.']
      }
    ]
  }
});
assert(createFullClassResult.success === true, 'executeAiToolCall create_full_class succeeded');
assert(createFullClassResult.lessonCount === 2, 'create_full_class generated 2 lessons');
const tefillinClass = sandbox.APP_STATE.customCourses.find(c => c.id === createFullClassResult.courseId);
assert(tefillinClass !== undefined, 'Full class found in customCourses');
assert(tefillinClass.lessons.length === 2, 'Full class contains exactly 2 lessons');

// Test Context Awareness in getPortalContextData
const portalContext = sandbox.getPortalContextData();
assert(Array.isArray(portalContext.courses), 'portalContext.courses is an array');
assert(portalContext.courses.length >= 2, 'portalContext.courses contains custom courses');
const contextCourse = portalContext.courses.find(c => c.id === chassidusCourse.id);
assert(contextCourse !== undefined, 'Chassidus course is present in portalContext.courses');
assert(contextCourse.lessons.length >= 1, 'Chassidus course in context lists its lessons with hooks');

// Test Navigation helpers
sandbox.navigateToCourse(chassidusCourse.id);
assert(sandbox.APP_STATE.activeTab === 'study', 'navigateToCourse switched tab to study');
assert(sandbox.APP_STATE.activeStudyCategory === 'lessons', 'navigateToCourse switched study category to lessons');
assert(sandbox.APP_STATE.activeCourseId === chassidusCourse.id, 'navigateToCourse set activeCourseId');

sandbox.navigateToLesson(chassidusCourse.id, chassidusLesson.id);
assert(sandbox.APP_STATE.expandedCustomLessonIds[chassidusLesson.id] === true, 'navigateToLesson expanded custom lesson');

// Gate 11: Lesson Accordion, Student Profile Navigation & Voice Recording Studio
console.log('\n--- Gate 11: Lesson Accordion, Student Navigation & Audio Studio ---');

// Test toggleCustomLessonAccordion
assert(typeof sandbox.toggleCustomLessonAccordion === 'function', 'toggleCustomLessonAccordion is a function');
sandbox.toggleCustomLessonAccordion(chassidusLesson.id);
assert(sandbox.APP_STATE.expandedCustomLessonIds[chassidusLesson.id] === false, 'toggleCustomLessonAccordion collapses expanded lesson');
sandbox.toggleCustomLessonAccordion(chassidusLesson.id);
assert(sandbox.APP_STATE.expandedCustomLessonIds[chassidusLesson.id] === true, 'toggleCustomLessonAccordion re-expands lesson');

// Test navigateToLesson closes student drawer
sandbox.APP_STATE.activeStudentDrawerId = dummyStudent.id;
sandbox.navigateToLesson(chassidusCourse.id, chassidusLesson.id);
assert(sandbox.APP_STATE.activeStudentDrawerId === null, 'navigateToLesson automatically closes student drawer');

// Test toggleTopicForStudent with dual keys and clean uncheck
assert(typeof sandbox.toggleTopicForStudent === 'function', 'toggleTopicForStudent is a function');
const testTopicKey = 'course_test_lesson_1';
const testLessonId = 'lesson_1';
sandbox.toggleTopicForStudent(dummyStudent.id, testTopicKey, testLessonId);
assert(dummyStudent.completedTopics[testTopicKey] === true, 'toggleTopicForStudent marked topicKey true');
assert(dummyStudent.completedTopics[testLessonId] === true, 'toggleTopicForStudent marked lessonId true');
assert(dummyStudent.completed_topics[testTopicKey] === true, 'toggleTopicForStudent synced completed_topics topicKey');
assert(dummyStudent.completed_topics[testLessonId] === true, 'toggleTopicForStudent synced completed_topics lessonId');

// Uncheck
sandbox.toggleTopicForStudent(dummyStudent.id, testTopicKey, testLessonId);
assert(dummyStudent.completedTopics[testTopicKey] === undefined, 'toggleTopicForStudent deleted topicKey on uncheck');
assert(dummyStudent.completedTopics[testLessonId] === undefined, 'toggleTopicForStudent deleted lessonId on uncheck');
assert(dummyStudent.completed_topics[testTopicKey] === undefined, 'toggleTopicForStudent cleared completed_topics on uncheck');

// Test toggleParshaForStudent
assert(typeof sandbox.toggleParshaForStudent === 'function', 'toggleParshaForStudent is a function');
sandbox.toggleParshaForStudent(dummyStudent.id, 'parsha_noach');
assert(dummyStudent.completedParshiot['parsha_noach'] === true, 'toggleParshaForStudent marked parsha completed');
assert(dummyStudent.completed_parshiot['parsha_noach'] === true, 'toggleParshaForStudent synced completed_parshiot');
sandbox.toggleParshaForStudent(dummyStudent.id, 'parsha_noach');
assert(dummyStudent.completedParshiot['parsha_noach'] === undefined, 'toggleParshaForStudent cleared parsha on uncheck');

// Test student voice recording via saveRecordedAudioToTarget
assert(typeof sandbox.saveRecordedAudioToTarget === 'function', 'saveRecordedAudioToTarget is a function');
sandbox.saveRecordedAudioToTarget(
  { type: 'student_parsha', studentId: dummyStudent.id },
  'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=',
  'Trope Practice - Aliyah 1'
);
assert(Array.isArray(dummyStudent.skills.parshaReading.recordings), 'Student parshaReading recordings is an array');
const studentRecording = dummyStudent.skills.parshaReading.recordings.find(r => r.title === 'Trope Practice - Aliyah 1');
assert(studentRecording !== undefined, 'Voice memo successfully attached to student parsha reading recordings');
assert(studentRecording.url.startsWith('data:audio/webm'), 'Student recording retained audio data URL');

// Test student audio UI and error recovery functions
assert(typeof sandbox.handleParshaAudioSelected === 'function', 'handleParshaAudioSelected is a function');
assert(typeof sandbox.promptAddParshaAudioLink === 'function', 'promptAddParshaAudioLink is a function');
assert(typeof sandbox.promptReplaceParshaAudioUrl === 'function', 'promptReplaceParshaAudioUrl is a function');
assert(typeof sandbox.deleteParshaRecording === 'function', 'deleteParshaRecording is a function');
assert(typeof sandbox.handleAudioPlaybackError === 'function', 'handleAudioPlaybackError is a function');

// Test HTML elements and handlers in indexHtml
assert(indexHtml.includes('handleAudioPlaybackError'), 'HTML includes handleAudioPlaybackError handler');
assert(indexHtml.includes('promptReplaceParshaAudioUrl'), 'HTML includes promptReplaceParshaAudioUrl action');
assert(indexHtml.includes("startVoiceRecording('student_parsha'"), 'HTML includes in-browser student voice recording button');
assert(indexHtml.includes('id="voice-recording-hud" class="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100]'), 'Voice recording HUD has z-[100] z-index');

// Gate 12: Individual User Authentication & Shared School Workspace Architecture
console.log('\n--- Gate 12: Individual User Authentication & Shared School Workspaces ---');

// 1. Registry & School Model
assert(sandbox.DEFAULT_SCHOOL !== undefined, 'DEFAULT_SCHOOL constant is defined');
assert(sandbox.DEFAULT_SCHOOL.id === 'school_main_770', 'DEFAULT_SCHOOL id is school_main_770');
assert(sandbox.DEFAULT_SCHOOL.join_code === '770770', 'DEFAULT_SCHOOL join_code is 770770');
assert(typeof sandbox.getSchoolsRegistry === 'function', 'getSchoolsRegistry is a function');
const schools = sandbox.getSchoolsRegistry();
assert(Array.isArray(schools), 'getSchoolsRegistry returns an array');
assert(schools.some(s => s.id === 'school_main_770'), 'Registry contains default Bar Mitzvah Academy');

// 2. School Lookup by Join Code
assert(typeof sandbox.findSchoolByJoinCode === 'function', 'findSchoolByJoinCode is a function');
const foundSchool = sandbox.findSchoolByJoinCode('770770');
assert(foundSchool !== null && foundSchool.id === 'school_main_770', 'findSchoolByJoinCode correctly resolves code 770770 to default school');
const foundSchoolWhitespace = sandbox.findSchoolByJoinCode('  770770  ');
assert(foundSchoolWhitespace !== null && foundSchoolWhitespace.id === 'school_main_770', 'findSchoolByJoinCode handles whitespace trimming');
const invalidSchool = sandbox.findSchoolByJoinCode('INVALID999');
assert(invalidSchool === null, 'findSchoolByJoinCode returns null for nonexistent code');

// 3. Dynamic School Scoping via getActiveSchoolId
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com' };
assert(sandbox.getActiveSchoolId() === 'school_main_770', 'Shmuel resolves to school_main_770');
sandbox.APP_STATE.currentUser = { email: 'coteacher@school.org', school_id: 'school_main_770' };
assert(sandbox.getActiveSchoolId() === 'school_main_770', 'Co-teacher with school_main_770 resolves to school_main_770');
sandbox.APP_STATE.currentUser = { email: 'tutor@external.edu' };
assert(sandbox.getActiveSchoolId() === 'tutor_external_edu', 'External tutor without school resolves to user-scoped ID');
sandbox.APP_STATE.currentUser = { email: 'tutor@external.edu', school_id: 'school_main_770' };
assert(sandbox.getActiveSchoolId() === 'school_main_770', 'External tutor who joined school resolves to school_main_770');

// 4. Strict Individual Authentication via grantAuthSession
assert(typeof sandbox.grantAuthSession === 'function', 'grantAuthSession is a function');

// Test Shmuel Login: Super Admin identity preserved
sandbox.grantAuthSession({
  email: 'shmueldoviduhlman@gmail.com'
});
assert(sandbox.APP_STATE.currentUser.email === 'shmueldoviduhlman@gmail.com', 'Shmuel session has his own email');
assert(sandbox.APP_STATE.currentUser.role === 'super_admin', 'Shmuel session receives super_admin role');
assert(sandbox.APP_STATE.currentUser.name_en === 'Shmuel Dovid Uhlman', 'Shmuel session preserves Shmuel full name');
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'Shmuel session attached to school_main_770');

// Test Co-Teacher Login: Individual identity preserved (NOT overwritten with Shmuel's identity)
sandbox.grantAuthSession({
  email: 'coteacher@school.org',
  name_en: 'Yossi Cohen',
  school_id: 'school_main_770'
});
assert(sandbox.APP_STATE.currentUser.email === 'coteacher@school.org', 'Co-teacher session has their own email');
assert(sandbox.APP_STATE.currentUser.name_en === 'Yossi Cohen', 'Co-teacher session preserves their own name (not Shmuel)');
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'Co-teacher attached to shared school_main_770');
assert(sandbox.APP_STATE.currentUser.role === 'tutor', 'Co-teacher role is tutor');

// Test Add/Remove Co-Teacher Handlers
assert(typeof sandbox.handleAddTeacherToSchool === 'function', 'handleAddTeacherToSchool is a function');
assert(typeof sandbox.handleRemoveTeacherFromSchool === 'function', 'handleRemoveTeacherFromSchool is a function');

// 5. External Tutor Registration & Dynamic School Attachment
// Case A: External tutor signs up with code 770770 -> joins shared school
sandbox.grantAuthSession({
  email: 'assistant@shul.org',
  name_en: 'Assistant Levi',
  school_id: 'school_main_770',
  school_name: 'Bar Mitzvah Academy'
});
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'Assistant with code 770770 joined school_main_770');
assert(sandbox.getStudentStorageKey() === 'tutor_students_v1', 'Assistant accesses shared student roster storage');

// Case B: External tutor signs up WITHOUT code -> gets isolated workspace
sandbox.grantAuthSession({
  email: 'private_tutor@math.com',
  name_en: 'Private Math Tutor'
});
assert(sandbox.APP_STATE.currentUser.school_id === 'private_tutor_math_com', 'Private tutor receives isolated school_id');
assert(sandbox.getStudentStorageKey() === 'tutor_students_private_tutor_math_com', 'Private tutor receives isolated student storage');

// 6. In-App School Join Engine
assert(typeof sandbox.handleJoinSchoolSubmit === 'function', 'handleJoinSchoolSubmit is a function');
assert(typeof sandbox.openJoinSchoolModal === 'function', 'openJoinSchoolModal is a function');
assert(typeof sandbox.closeJoinSchoolModal === 'function', 'closeJoinSchoolModal is a function');

// Simulate private tutor joining Bar Mitzvah Academy via modal
getOrCreateElem('input-join-school-code').value = '770770';
sandbox.handleJoinSchoolSubmit({ preventDefault() {} });
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'handleJoinSchoolSubmit transitioned private tutor into school_main_770');
assert(sandbox.APP_STATE.currentUser.school_name === 'Bar Mitzvah Academy', 'handleJoinSchoolSubmit updated school_name');

// Verify member was recorded into school registry
const updatedSchools = sandbox.getSchoolsRegistry();
const targetAcademy = updatedSchools.find(s => s.id === 'school_main_770');
assert(targetAcademy && targetAcademy.members.some(m => m.email === 'private_tutor@math.com'), 'New member recorded in school registry');

// 7. URL Join Code Detection
assert(typeof sandbox.checkUrlJoinCode === 'function', 'checkUrlJoinCode is a function');

// 8. HTML Components & Modals
assert(indexHtml.includes('id="modal-school-workspace"'), 'HTML contains modal-school-workspace');
assert(indexHtml.includes('id="modal-join-school"'), 'HTML contains modal-join-school');
assert(indexHtml.includes('id="signup-school-code"'), 'HTML contains signup-school-code input field');
assert(indexHtml.includes('id="btn-open-school-workspace"'), 'HTML contains btn-open-school-workspace in profile menu');
assert(indexHtml.includes('id="btn-open-join-school"'), 'HTML contains btn-open-join-school in profile menu');
assert(indexHtml.includes('id="school-join-code-value"'), 'HTML contains school-join-code-value element');
assert(indexHtml.includes('copySchoolJoinCode'), 'HTML includes copySchoolJoinCode handler');
assert(indexHtml.includes('shareSchoolJoinCodeWhatsApp'), 'HTML includes shareSchoolJoinCodeWhatsApp handler');

// Gate 13: Pan-System AI Agents & Tool Execution Engine
console.log('\n--- Gate 13: Pan-System AI Agents & Tool Execution Engine ---');

// 1. Tool Declarations Coverage
assert(typeof sandbox.buildGeminiToolsDeclaration === 'function', 'buildGeminiToolsDeclaration is a function');
const allToolsDecl = sandbox.buildGeminiToolsDeclaration();
assert(Array.isArray(allToolsDecl) && allToolsDecl.length > 0, 'Tools declaration returns an array');
const declaredFuncs = allToolsDecl[0].functionDeclarations || [];
const g13_toolNames = declaredFuncs.map(f => f.name);

const requiredTools = [
  'add_student',
  'update_student',
  'schedule_lesson',
  'cancel_lesson',
  'mark_topic_progress',
  'mark_parsha_progress',
  'add_study_material',
  'get_portal_data',
  'create_lesson',
  'create_course',
  'create_full_class'
];

requiredTools.forEach(tool => {
  assert(g13_toolNames.includes(tool), `Tool "${tool}" is declared in Gemini tools manifest`);
});

// 2. Tool Execution: add_student with full schema & school_id
sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com', school_id: 'school_main_770' };
sandbox.APP_STATE.students = [];
const addRes = sandbox.executeAiToolCall({
  name: 'add_student',
  args: {
    name: 'Gavriel Cohen',
    parsha: 'Parshat Terumah',
    barMitzvahDate: '2027-02-15',
    notes: 'Initial evaluation by AI agent'
  }
});

assert(addRes.success === true, 'executeAiToolCall add_student succeeded');
const createdStu = sandbox.APP_STATE.students.find(s => s.name === 'Gavriel Cohen');
assert(createdStu !== undefined, 'Created student found in APP_STATE.students');
assert(createdStu.parsha === 'Parshat Terumah', 'Student parsha initialized correctly');
assert(Array.isArray(createdStu.schedule), 'Student schedule initialized as an array');
assert(typeof createdStu.completedTopics === 'object', 'Student completedTopics initialized as an object');
assert(typeof createdStu.completedParshiot === 'object', 'Student completedParshiot initialized as an object');
assert(createdStu.skills && createdStu.skills.parshaReading.parshaName === 'Parshat Terumah', 'Student skills initialized with parshaName');
assert(createdStu.completed_topics._meta.school_id === 'school_main_770', 'Student stamped with school_main_770');

// 3. Tool Execution: update_student
const updateRes = sandbox.executeAiToolCall({
  name: 'update_student',
  args: {
    studentNameOrId: 'Gavriel Cohen',
    newName: 'Gavriel (Gabi) Cohen',
    notes: 'Updated notes: excellent trope pronunciation',
    parsha: 'Parshat Tetzaveh'
  }
});
assert(updateRes.success === true, 'executeAiToolCall update_student succeeded');
assert(createdStu.name === 'Gavriel (Gabi) Cohen', 'Student name updated to new name');
assert(createdStu.notes.includes('excellent trope'), 'Student notes updated');
assert(createdStu.parsha === 'Parshat Tetzaveh', 'Student parsha updated');
assert(createdStu.skills.parshaReading.parshaName === 'Parshat Tetzaveh', 'Skills parsha reading synchronized');

// 4. Tool Execution: schedule_lesson & dual-store synchronization
const schedRes = sandbox.executeAiToolCall({
  name: 'schedule_lesson',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    date: '2026-12-10',
    timeSlot: '5:00 PM',
    subject: 'Tetzaveh Aliyah 1 & Tefillin Review'
  }
});
assert(schedRes.success === true, 'executeAiToolCall schedule_lesson succeeded');
assert(createdStu.schedule.length === 1, 'Lesson appended to student.schedule');
assert(createdStu.schedule[0].dateStr === '2026-12-10', 'Lesson date recorded in schedule');
assert(createdStu.schedule[0].time === '5:00 PM', 'Lesson time recorded in schedule');
assert(createdStu.completed_topics._meta.lessons.length === 1, 'Lesson mirrored to completed_topics._meta.lessons');
assert(createdStu.completed_topics._meta.lessons[0].subject === 'Tetzaveh Aliyah 1 & Tefillin Review', 'Subject recorded in mirrored lesson');

// Test on-the-fly student creation via schedule_lesson
const onTheFlyRes = sandbox.executeAiToolCall({
  name: 'schedule_lesson',
  args: {
    studentNameOrId: 'Daniel Newstudent',
    date: '2026-12-12',
    timeSlot: '4:30 PM',
    subject: 'First Intro Session'
  }
});
assert(onTheFlyRes.success === true, 'schedule_lesson on-the-fly creation succeeded');
const onTheFlyStu = sandbox.APP_STATE.students.find(s => s.name === 'Daniel Newstudent');
assert(onTheFlyStu !== undefined, 'On-the-fly student created in APP_STATE.students');
assert(onTheFlyStu.completed_topics._meta.school_id === 'school_main_770', 'On-the-fly student stamped with active school ID');

// 5. Tool Execution: cancel_lesson
const cancelRes = sandbox.executeAiToolCall({
  name: 'cancel_lesson',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    date: '2026-12-10'
  }
});
assert(cancelRes.success === true, 'executeAiToolCall cancel_lesson succeeded');
assert(createdStu.schedule.length === 0, 'Lesson removed from student.schedule');
assert(createdStu.completed_topics._meta.lessons.length === 0, 'Lesson removed from completed_topics._meta.lessons');

// 6. Tool Execution: mark_topic_progress dual-store toggle
const markTopicRes = sandbox.executeAiToolCall({
  name: 'mark_topic_progress',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    topicId: 'tefillin',
    completed: true
  }
});
assert(markTopicRes.success === true, 'executeAiToolCall mark_topic_progress true succeeded');
assert(createdStu.completedTopics['tefillin'] === true, 'completedTopics tefillin is true');
assert(createdStu.completed_topics['tefillin'] === true, 'completed_topics tefillin is true');

const unmarkTopicRes = sandbox.executeAiToolCall({
  name: 'mark_topic_progress',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    topicId: 'tefillin',
    completed: false
  }
});
assert(unmarkTopicRes.success === true, 'executeAiToolCall mark_topic_progress false succeeded');
assert(createdStu.completedTopics['tefillin'] === undefined, 'completedTopics tefillin was cleared');
assert(createdStu.completed_topics['tefillin'] === undefined, 'completed_topics tefillin was cleared');

// 7. Tool Execution: mark_parsha_progress dual-store toggle
const markParshaRes = sandbox.executeAiToolCall({
  name: 'mark_parsha_progress',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    parshaId: 'bereishit',
    completed: true
  }
});
assert(markParshaRes.success === true, 'executeAiToolCall mark_parsha_progress true succeeded');
assert(createdStu.completedParshiot['bereishit'] === true, 'completedParshiot bereishit is true');
assert(createdStu.completed_parshiot['bereishit'] === true, 'completed_parshiot bereishit is true');

const unmarkParshaRes = sandbox.executeAiToolCall({
  name: 'mark_parsha_progress',
  args: {
    studentNameOrId: 'Gavriel (Gabi) Cohen',
    parshaId: 'bereishit',
    completed: false
  }
});
assert(unmarkParshaRes.success === true, 'executeAiToolCall mark_parsha_progress false succeeded');
assert(createdStu.completedParshiot['bereishit'] === undefined, 'completedParshiot bereishit was cleared');
assert(createdStu.completed_parshiot['bereishit'] === undefined, 'completed_parshiot bereishit was cleared');

// 8. Tool Execution: add_study_material
const addMatRes = sandbox.executeAiToolCall({
  name: 'add_study_material',
  args: {
    targetNameOrId: 'tefillin',
    title: 'The Rebbe on Tefillin in the Modern World',
    content: 'Story of how putting on Tefillin protects the Jewish nation spiritually and physically.'
  }
});
assert(addMatRes.success === true, 'executeAiToolCall add_study_material succeeded');
assert(sandbox.APP_STATE.studyAdditions && sandbox.APP_STATE.studyAdditions['tefillin'].length > 0, 'Material attached to tefillin concept');
assert(sandbox.APP_STATE.studyAdditions['tefillin'][0].title === 'The Rebbe on Tefillin in the Modern World', 'Material title recorded');

// 9. Tool Execution: get_portal_data
const portalData = sandbox.executeAiToolCall({
  name: 'get_portal_data',
  args: {}
});
assert(portalData !== null && typeof portalData === 'object', 'get_portal_data returns object');
assert(portalData.totalStudents >= 2, 'get_portal_data returns accurate student count');
assert(portalData.activeSchoolId === 'school_main_770', 'get_portal_data returns active school ID');
assert(portalData.totalCustomMaterialsAdded >= 1, 'get_portal_data includes custom materials count');
assert(Array.isArray(portalData.students), 'portalData.students is an array');
assert(Array.isArray(portalData.courses), 'portalData.courses is an array');

// 10. Tool Execution: create_course, create_lesson & create_full_class
const g13_createCourseRes = sandbox.executeAiToolCall({
  name: 'create_course',
  args: {
    title_en: 'Jewish Ethics & Middot',
    title_he: 'מידות ומוסר',
    category: 'Mussar',
    target_level: 'Bar Mitzvah',
    description_en: 'Building character and fine character traits',
    icon: '💎'
  }
});
assert(g13_createCourseRes.success === true, 'executeAiToolCall create_course succeeded');
const g13_createdCourse = sandbox.APP_STATE.customCourses.find(c => c.id === g13_createCourseRes.courseId);
assert(g13_createdCourse !== undefined, 'Created course exists in APP_STATE.customCourses');
assert(g13_createdCourse.title_en === 'Jewish Ethics & Middot', 'Course English title preserved');
assert(g13_createdCourse.icon === '💎', 'Course icon preserved');

const g13_createLessonRes = sandbox.executeAiToolCall({
  name: 'create_lesson',
  args: {
    courseIdOrName: g13_createdCourse.id,
    title_en: 'True Humility: Learning from Moshe',
    title_he: 'ענווה אמיתית: ללמוד ממשה רבנו',
    hook_en: 'Is true humility being a pushover or knowing your infinite soul value?',
    anchors_en: [
      '**Definition**: Humility is not thinking less of yourself, it is thinking of yourself less.',
      '**Moshe Rabbeinu**: The most humble man on earth, yet stood strong before Pharaoh.',
      '**Inner Strength**: Humility gives you peace because ego is silenced.'
    ],
    midrash_en: 'Why did God give the Torah on Mount Sinai and not on Mount Tabor?',
    life_app_en: 'When someone insults you in school, remember who you are inside without reacting.',
    discussion_en: 'Can a champion athlete or CEO be genuinely humble?'
  }
});
assert(g13_createLessonRes.success === true, 'executeAiToolCall create_lesson succeeded');
assert(g13_createdCourse.lessons.length === 1, 'Lesson appended to createdCourse');
const g13_createdLesson = g13_createdCourse.lessons[0];
assert(g13_createdLesson.title_en.includes('True Humility'), 'Lesson title matches');
assert(g13_createdLesson.anchors_en.length === 3, 'Lesson has 3 anchors');
assert(g13_createdLesson.anchors_en[0].includes('**Definition**'), 'Anchor formatted with bold keyword');
assert(g13_createdLesson.midrash_en.includes('Mount Sinai'), 'Midrash nugget recorded');
assert(g13_createdLesson.life_app_en.includes('someone insults you'), 'Life app recorded');

// 11. Dedicated AI Builders: Reading Ladder Generator
assert(typeof sandbox.handleGenerateReadingLadder === 'function', 'handleGenerateReadingLadder is a function');
getOrCreateElem('ai-reading-topic').value = 'Haftarah Tropes & Accents';
getOrCreateElem('ai-reading-level').value = 'Intermediate';
getOrCreateElem('ai-reading-count').value = '4';
getOrCreateElem('ai-reading-guidance').value = 'Focus on Munach, Etnachta, and Sof Pasuk';
sandbox.APP_STATE.customReadingMaterials = [];

sandbox.handleGenerateReadingLadder({ preventDefault() {} });
assert(sandbox.APP_STATE.customReadingMaterials.length === 4, 'handleGenerateReadingLadder generated 4 reading levels');
assert(sandbox.APP_STATE.customReadingMaterials[0].title.includes('Level 1'), 'Reading unit has Level 1 title');
assert(sandbox.APP_STATE.customReadingMaterials[0].targets.length > 0, 'Reading unit has target vocabulary');

// 12. Dedicated AI Builders: Milestone Roadmap Generator
assert(typeof sandbox.handleGenerateMilestoneRoadmap === 'function', 'handleGenerateMilestoneRoadmap is a function');
getOrCreateElem('ai-milestone-topic').value = 'Bar Mitzvah Dvar Torah';
getOrCreateElem('ai-milestone-level').value = 'Teens';
getOrCreateElem('ai-milestone-count').value = '5';
getOrCreateElem('ai-milestone-guidance').value = 'Stage by stage speech preparation';
sandbox.APP_STATE.customMilestones = [];

sandbox.handleGenerateMilestoneRoadmap({ preventDefault() {} });
assert(sandbox.APP_STATE.customMilestones.length === 5, 'handleGenerateMilestoneRoadmap generated 5 milestone stages');
assert(sandbox.APP_STATE.customMilestones[0].stage_num === 1, 'First milestone stage is stage 1');
assert(sandbox.APP_STATE.customMilestones[0].deliverables.length > 0, 'Milestone stage has deliverables');

// 13. External AI Base44 Integration & OpenAPI Schema
const base44SchemaRaw = fs.readFileSync('base44_openapi_schema.json', 'utf8');
const base44Schema = JSON.parse(base44SchemaRaw);
assert(base44Schema.openapi === '3.0.3', 'Base44 OpenAPI schema version is 3.0.3');
assert(base44Schema.paths['/students_sync'] !== undefined, 'Base44 OpenAPI schema defines /students_sync endpoint');
assert(base44Schema.paths['/students_sync'].get !== undefined, 'Base44 schema declares GET /students_sync');
assert(base44Schema.paths['/students_sync'].post !== undefined, 'Base44 schema declares POST /students_sync');
assert(base44Schema.paths['/students_sync'].delete !== undefined, 'Base44 schema declares DELETE /students_sync');

// Verify Base44 Prompt population
assert(typeof sandbox.populateBase44PromptTextarea === 'function', 'populateBase44PromptTextarea is a function');
sandbox.populateBase44PromptTextarea();
const base44PromptVal = getOrCreateElem('base44-prompt-textarea').value;
assert(base44PromptVal.includes('@Base44 SYSTEM INTEGRATION PROTOCOL'), 'Base44 prompt textarea populated with protocol');
assert(base44PromptVal.includes('shabbat (Shabbat & Sacred Time)'), 'Base44 prompt includes 13 Jewish concepts');
assert(base44PromptVal.includes('bereishit, noach, lech_lecha'), 'Base44 prompt includes Chumash parshiot');
assert(base44PromptVal.includes('KEYWORD 1: SCHEDULE'), 'Base44 prompt defines SCHEDULE keyword');
assert(base44PromptVal.includes('KEYWORD 2: DEBRIEF'), 'Base44 prompt defines DEBRIEF keyword');
assert(base44PromptVal.includes('KEYWORD 3: NEXT LESSON'), 'Base44 prompt defines NEXT LESSON keyword');
assert(base44PromptVal.includes('KEYWORD 4: ADD MATERIAL'), 'Base44 prompt defines ADD MATERIAL keyword');

// 14. HTML UI Check for AI Assistant & Modals
assert(indexHtml.includes('id="modal-base44-integration"'), 'HTML contains modal-base44-integration');
assert(indexHtml.includes('id="modal-ai-curriculum-builder"'), 'HTML contains modal-ai-curriculum-builder');
assert(indexHtml.includes('id="modal-ai-reading-builder"'), 'HTML contains modal-ai-reading-builder');
assert(indexHtml.includes('id="modal-ai-milestone-builder"'), 'HTML contains modal-ai-milestone-builder');
assert(indexHtml.includes('id="ai-chat-input"'), 'HTML contains ai-chat-input');
assert(indexHtml.includes('handleSendAiMessage'), 'HTML binds handleSendAiMessage');

// ==============================================
// GATE 14: UNIVERSAL CURRICULUM BREAKDOWN & CLASS PLANNER SUITE
// ==============================================
console.log('\n--- Gate 14: Universal Curriculum Breakdown & Class Planner ---');

// 1. Function existence
assert(typeof sandbox.calculateNextScheduleDates === 'function', 'calculateNextScheduleDates is a function');
assert(typeof sandbox.openBreakdownPlannerModal === 'function', 'openBreakdownPlannerModal is a function');
assert(typeof sandbox.closeBreakdownPlannerModal === 'function', 'closeBreakdownPlannerModal is a function');
assert(typeof sandbox.updatePlannerPreviewList === 'function', 'updatePlannerPreviewList is a function');
assert(typeof sandbox.handleExecuteBreakdownPlan === 'function', 'handleExecuteBreakdownPlan is a function');

// 2. Date calculation across cadences
const twiceWeeklyDates = sandbox.calculateNextScheduleDates('2026-11-16', 'twice_weekly', 15);
assert(Array.isArray(twiceWeeklyDates), 'calculateNextScheduleDates returns an array');
assert(twiceWeeklyDates.length === 15, 'calculateNextScheduleDates returns exactly 15 dates');
const allMonWed = twiceWeeklyDates.every(d => {
  const day = new Date(d + 'T12:00:00').getDay();
  return day === 1 || day === 3;
});
assert(allMonWed, 'twice_weekly cadence generates strictly Mondays and Wednesdays');

const tuesThursDates = sandbox.calculateNextScheduleDates('2026-11-17', 'tues_thurs', 10);
assert(tuesThursDates.length === 10, 'tues_thurs cadence generates 10 dates');
const allTueThu = tuesThursDates.every(d => {
  const day = new Date(d + 'T12:00:00').getDay();
  return day === 2 || day === 4;
});
assert(allTueThu, 'tues_thurs cadence generates strictly Tuesdays and Thursdays');

const sundayDates = sandbox.calculateNextScheduleDates('2026-11-15', 'once_weekly_sun', 8);
assert(sundayDates.length === 8, 'once_weekly_sun generates 8 dates');
const allSun = sundayDates.every(d => new Date(d + 'T12:00:00').getDay() === 0);
assert(allSun, 'once_weekly_sun generates strictly Sundays');

// 3. HTML Containers & Modals
assert(indexHtml.includes('id="modal-curriculum-breakdown-planner"'), 'HTML contains modal-curriculum-breakdown-planner');
assert(indexHtml.includes('id="planner-student-select"'), 'HTML contains planner-student-select');
assert(indexHtml.includes('id="planner-course-select"'), 'HTML contains planner-course-select');
assert(indexHtml.includes('id="planner-classes-count"'), 'HTML contains planner-classes-count');
assert(indexHtml.includes('id="planner-start-date"'), 'HTML contains planner-start-date');
assert(indexHtml.includes('id="planner-cadence-select"'), 'HTML contains planner-cadence-select');
assert(indexHtml.includes('id="planner-time-slot"'), 'HTML contains planner-time-slot');
assert(indexHtml.includes('id="planner-preview-container"'), 'HTML contains planner-preview-container');
assert(indexHtml.includes('btn-calendar-plan-breakdown'), 'HTML contains Calendar toolbar breakdown planner trigger');

// 4. Modal lifecycle
sandbox.openBreakdownPlannerModal();
const plannerModalEl = getOrCreateElem('modal-curriculum-breakdown-planner');
assert(!plannerModalEl.classList.contains('hidden'), 'openBreakdownPlannerModal unhides modal');
sandbox.closeBreakdownPlannerModal();
assert(plannerModalEl.classList.contains('hidden'), 'closeBreakdownPlannerModal hides modal');

// 5. Test Live Execution of Breakdown Plan
const testStudentForPlan = {
  id: 'stu_planner_test',
  name: 'Planner Student',
  schedule: [],
  completedTopics: {},
  completed_topics: { _meta: { lessons: [] } }
};
sandbox.APP_STATE.students = [testStudentForPlan];
const testCourseForPlan = {
  id: 'course_plan_math',
  title_en: 'Universal Math',
  title_he: 'מתמטיקה אוניברסלית',
  format_type: 'standard',
  lessons: [
    { id: 'les_m1', title_en: 'Algebra Foundations', title_he: 'יסודות האלגברה' },
    { id: 'les_m2', title_en: 'Linear Equations', title_he: 'משוואות לינאריות' },
    { id: 'les_m3', title_en: 'Quadratic Systems', title_he: 'מערכות ריבועיות' }
  ]
};
sandbox.APP_STATE.customCourses = [testCourseForPlan];

getOrCreateElem('planner-student-select').value = 'stu_planner_test';
getOrCreateElem('planner-course-select').value = 'course_plan_math';
getOrCreateElem('planner-classes-count').value = '5';
getOrCreateElem('planner-start-date').value = '2026-11-16';
getOrCreateElem('planner-cadence-select').value = 'twice_weekly';
getOrCreateElem('planner-time-slot').value = '5:00 PM';

sandbox.updatePlannerPreviewList();
const previewContent = getOrCreateElem('planner-preview-container').innerHTML;
assert(previewContent.includes('Algebra Foundations'), 'Preview contains Lesson 1 title');
assert(previewContent.includes('Linear Equations'), 'Preview contains Lesson 2 title');

// Execute plan
sandbox.handleExecuteBreakdownPlan({ preventDefault: () => {} });
assert(testStudentForPlan.schedule.length === 5, 'Student schedule received exactly 5 planned sessions');
assert(testStudentForPlan.completed_topics._meta.lessons.length === 5, 'Mirror lessons received 5 planned sessions');
assert(testStudentForPlan.schedule[0].topic.includes('Algebra Foundations'), 'First session mapped to Lesson 1');
assert(testStudentForPlan.schedule[0].course_id === 'course_plan_math', 'Session recorded course_id');
assert(testStudentForPlan.schedule[0].time === '5:00 PM', 'Session recorded time slot');

// 6. Test AI Tool: plan_curriculum_breakdown
const g14_tools = sandbox.buildGeminiToolsDeclaration();
const g14_toolNames = g14_tools[0].functionDeclarations.map(f => f.name);
assert(g14_toolNames.includes('plan_curriculum_breakdown'), 'Tool "plan_curriculum_breakdown" declared in Gemini tools manifest');

const aiBreakdownResult = sandbox.executeAiToolCall({
  name: 'plan_curriculum_breakdown',
  args: {
    studentNameOrId: 'Planner Student',
    courseIdOrName: 'Universal Math',
    totalClasses: 3,
    startDate: '2026-12-01',
    cadence: 'twice_weekly',
    timeSlot: '4:00 PM'
  }
});
assert(aiBreakdownResult.success === true, 'AI plan_curriculum_breakdown executed successfully');
assert(aiBreakdownResult.scheduledCount === 3, 'AI scheduled exact class count');
assert(Array.isArray(aiBreakdownResult.actionCards), 'AI returned actionCards array');
assert(aiBreakdownResult.actionCards.some(c => c.type === 'calendar'), 'Action card includes calendar jump');
assert(aiBreakdownResult.actionCards.some(c => c.type === 'student'), 'Action card includes student drawer link');

// 7. Base44 Dynamic Prompt with KEYWORD 5: BREAKDOWN
sandbox.populateBase44PromptTextarea();
const g14_base44Val = getOrCreateElem('base44-prompt-textarea').value;
assert(g14_base44Val.includes('KEYWORD 5: BREAKDOWN'), 'Base44 prompt defines KEYWORD 5: BREAKDOWN');
assert(g14_base44Val.includes('Active School Filter'), 'Base44 prompt defines dynamic Active School Filter');

// 8. Class Format Type in Save Custom Course
assert(indexHtml.includes('id="input-create-course-format-type"'), 'HTML contains input-create-course-format-type');
getOrCreateElem('input-create-course-title-en').value = 'Graded Hebrew Reading';
getOrCreateElem('input-create-course-format-type').value = 'reading';
sandbox.handleSaveCustomCourse({ preventDefault: () => {} });
const savedReadingCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Graded Hebrew Reading');
assert(savedReadingCourse !== undefined, 'Saved course exists in customCourses');
assert(savedReadingCourse.format_type === 'reading', 'Course format_type saved as reading');
assert(savedReadingCourse.icon === '📖', 'Reading course default icon is 📖');

// 9. Clean Canvas Reset & On-Demand Template Seeding
assert(typeof sandbox.checkCleanCanvasReset === 'function', 'checkCleanCanvasReset is a function');
assert(typeof sandbox.handleResetWorkspaceToCleanSlate === 'function', 'handleResetWorkspaceToCleanSlate is a function');
assert(typeof sandbox.handleLoadStarterBarMitzvahTemplate === 'function', 'handleLoadStarterBarMitzvahTemplate is a function');
assert(indexHtml.includes('id="lbl-load-template-btn"'), 'HTML contains Load Bar Mitzvah Template trigger in blank state');
assert(indexHtml.includes('id="lbl-reset-workspace-btn"'), 'HTML contains Reset Workspace to Blank Canvas trigger');

// Gate 15: Two-Part Study Section (Courses & Classes) & In-Modal AI Assistant
console.log('\n--- Gate 15: Two-Part Study Section (Courses & Classes) & In-Modal AI Assistant ---');
assert(indexHtml.includes('id="study-level-courses"'), 'HTML contains study-level-courses container');
assert(indexHtml.includes('id="study-level-classes"'), 'HTML contains study-level-classes container');
assert(indexHtml.includes('id="courses-cards-grid"'), 'HTML contains courses-cards-grid');
assert(indexHtml.includes('id="inside-course-header-card"'), 'HTML contains inside-course-header-card');
assert(indexHtml.includes('id="input-ai-class-prompt"'), 'HTML contains input-ai-class-prompt in lesson modal');
assert(indexHtml.includes('id="btn-run-ai-class-assistant"'), 'HTML contains btn-run-ai-class-assistant');

assert(typeof sandbox.showAllCoursesView === 'function', 'showAllCoursesView is a function');
assert(typeof sandbox.openCourseClassesView === 'function', 'openCourseClassesView is a function');
assert(typeof sandbox.renderCoursesCardsGrid === 'function', 'renderCoursesCardsGrid is a function');
assert(typeof sandbox.renderInsideCourseHeader === 'function', 'renderInsideCourseHeader is a function');
assert(typeof sandbox.openAiCreateClassModal === 'function', 'openAiCreateClassModal is a function');
assert(typeof sandbox.handleAiClassAssist === 'function', 'handleAiClassAssist is a function');
assert(typeof sandbox.applyAiQuickPrompt === 'function', 'applyAiQuickPrompt is a function');

// Test Course Navigation Transitions
sandbox.openCourseClassesView(savedReadingCourse.id);
assert(sandbox.APP_STATE.insideCourseId === savedReadingCourse.id, 'insideCourseId updated on course navigation');
const levelCoursesElem = getOrCreateElem('study-level-courses');
const levelClassesElem = getOrCreateElem('study-level-classes');
assert(levelCoursesElem.classList.contains('hidden'), 'study-level-courses is hidden when viewing classes');
assert(!levelClassesElem.classList.contains('hidden'), 'study-level-classes is visible when viewing classes');

sandbox.showAllCoursesView();
assert(sandbox.APP_STATE.insideCourseId === null, 'insideCourseId reset to null in all courses view');
assert(!levelCoursesElem.classList.contains('hidden'), 'study-level-courses is visible in all courses view');
assert(levelClassesElem.classList.contains('hidden'), 'study-level-classes is hidden in all courses view');

// Test In-Modal AI Assistant Setup for Creation vs Refinement
sandbox.openAddCustomLessonModal(savedReadingCourse.id);
const aiTitleElem = getOrCreateElem('ai-class-tool-heading');
assert(aiTitleElem.textContent.includes('AI Class Assistant') && aiTitleElem.textContent.includes('Create'), 'Add modal configures AI Assistant for class creation');

// Seed a lesson into savedReadingCourse to test edit modal
savedReadingCourse.lessons = [{ id: 'les_test_1', title_en: 'Alphabet Mastery', hook_en: 'Why learn letters?' }];
sandbox.openEditCustomLessonModal(savedReadingCourse.id, 'les_test_1');
assert(aiTitleElem.textContent.includes('AI Class Assistant') && aiTitleElem.textContent.includes('Refine'), 'Edit modal configures AI Assistant for class refinement');

// Test Universal Course Picker Navigation Bar
assert(indexHtml.includes('id="study-courses-nav-bar"'), 'HTML contains study-courses-nav-bar');
assert(indexHtml.includes('id="study-courses-pills-container"'), 'HTML contains study-courses-pills-container');
assert(typeof sandbox.renderCoursePickerPills === 'function', 'renderCoursePickerPills is a function');
assert(typeof sandbox.handleSelectCoursePill === 'function', 'handleSelectCoursePill is a function');

sandbox.renderCoursePickerPills();
const navBarElem = getOrCreateElem('study-courses-nav-bar');
assert(navBarElem.classList.contains('hidden'), 'study-courses-nav-bar stays hidden to eliminate duplicate course bar clutter');
const pillsContainer = getOrCreateElem('study-courses-pills-container');
assert(pillsContainer.innerHTML.includes('Graded Hebrew Reading'), 'Course picker renders pills data for internal sync');

sandbox.handleSelectCoursePill(savedReadingCourse.id);
assert(sandbox.APP_STATE.activeCourseId === savedReadingCourse.id, 'handleSelectCoursePill updates activeCourseId');
assert(sandbox.APP_STATE.insideCourseId === savedReadingCourse.id, 'handleSelectCoursePill updates insideCourseId');

// Gate 16: Perfect Lesson Builder and Tutor Teleprompter Invariants
console.log('\n--- Gate 16: Perfect Lesson Builder & Tutor Teleprompter ---');
assert(indexHtml.includes('id="pill-block-sources"'), 'HTML contains pill-block-sources');
assert(indexHtml.includes('id="pill-block-pitfalls"'), 'HTML contains pill-block-pitfalls');
assert(indexHtml.includes('id="pill-block-cheat_sheet"'), 'HTML contains pill-block-cheat_sheet');
assert(indexHtml.includes('id="pill-block-steps"'), 'HTML contains pill-block-steps');
assert(indexHtml.includes('id="pill-block-homework"'), 'HTML contains pill-block-homework');

assert(indexHtml.includes('id="input-block-sources"'), 'HTML contains input-block-sources');
assert(indexHtml.includes('id="input-block-pitfalls"'), 'HTML contains input-block-pitfalls');
assert(indexHtml.includes('id="input-block-cheat-sheet"'), 'HTML contains input-block-cheat-sheet');
assert(indexHtml.includes('id="input-block-steps"'), 'HTML contains input-block-steps');
assert(indexHtml.includes('id="input-block-homework"'), 'HTML contains input-block-homework');

assert(indexHtml.includes('id="modal-tutor-teleprompter"'), 'HTML contains modal-tutor-teleprompter');
assert(indexHtml.includes('id="teleprompter-timer-display"'), 'HTML contains teleprompter-timer-display');
assert(indexHtml.includes('id="teleprompter-content-container"'), 'HTML contains teleprompter-content-container');

assert(typeof sandbox.toggleLessonBlock === 'function', 'toggleLessonBlock is a function');
assert(typeof sandbox.showLessonBlock === 'function', 'showLessonBlock is a function');
assert(typeof sandbox.hideLessonBlock === 'function', 'hideLessonBlock is a function');
assert(typeof sandbox.handleMiniBlockAi === 'function', 'handleMiniBlockAi is a function');
assert(typeof sandbox.openTutorTeleprompter === 'function', 'openTutorTeleprompter is a function');
assert(typeof sandbox.closeTutorTeleprompter === 'function', 'closeTutorTeleprompter is a function');
assert(typeof sandbox.toggleTeleprompterTimer === 'function', 'toggleTeleprompterTimer is a function');
assert(typeof sandbox.resetTeleprompterTimer === 'function', 'resetTeleprompterTimer is a function');
assert(typeof sandbox.toggleTeleprompterAnchorCheck === 'function', 'toggleTeleprompterAnchorCheck is a function');

// Test Modular Block Toggling
const sourcesContainer = getOrCreateElem('block-container-sources');
assert(sourcesContainer.classList.contains('hidden'), 'sources block is hidden initially');
sandbox.toggleLessonBlock('sources');
assert(!sourcesContainer.classList.contains('hidden'), 'toggleLessonBlock unhides sources block');
sandbox.toggleLessonBlock('sources');
assert(sourcesContainer.classList.contains('hidden'), 'toggleLessonBlock hides sources block again');

// Test Saving Lesson with Modular Blocks
sandbox.openAddCustomLessonModal(savedReadingCourse.id);
getOrCreateElem('input-custom-lesson-title-en').value = 'Mastering the Shulchan Aruch';
getOrCreateElem('input-custom-lesson-hook').value = 'Why do we need a set table for laws?';
getOrCreateElem('input-custom-lesson-anchors').value = '**Tur**: Four core pillars of Jewish law.\n**Beit Yosef**: Decisive halachic authority.\n**Rema**: Ashkenazi customary glosses.';
getOrCreateElem('input-custom-lesson-life-app').value = 'Navigating modern moral dilemmas with clear guidance.';
getOrCreateElem('input-custom-lesson-discussion').value = 'Can tradition evolve without losing its core?';
getOrCreateElem('input-block-sources').value = 'Tur Orach Chaim 1:1: Be strong like a lion to serve the Creator.';
getOrCreateElem('input-block-pitfalls').value = 'Students think the Rema argues on everything; in reality he supplements customs.';
getOrCreateElem('input-block-cheat-sheet').value = 'Remember to highlight the metaphor of a set table and tablecloth.';
getOrCreateElem('input-block-steps').value = '1. Identify the Mishna source.\n2. Trace the Talmudic debate.\n3. Read the Shulchan Aruch ruling.';
getOrCreateElem('input-block-homework').value = 'Find one halachic ruling in your home prayer book.';

sandbox.handleSaveCustomLesson({ preventDefault: () => {} });

const createdModularLesson = savedReadingCourse.lessons.find(l => l.title_en === 'Mastering the Shulchan Aruch');
assert(createdModularLesson !== undefined, 'Modular lesson was created and saved to course');
assert(createdModularLesson.sources_text.includes('Be strong like a lion'), 'Lesson saved sources text');
assert(createdModularLesson.pitfalls_text.includes('supplements customs'), 'Lesson saved pitfalls text');
assert(createdModularLesson.cheat_sheet_text.includes('set table and tablecloth'), 'Lesson saved cheat sheet text');
assert(createdModularLesson.steps_text.includes('Trace the Talmudic debate'), 'Lesson saved steps text');
assert(createdModularLesson.homework_text.includes('Find one halachic ruling'), 'Lesson saved homework text');

// Test Tutor Teleprompter Launch and Rendering
sandbox.openTutorTeleprompter(savedReadingCourse.id, createdModularLesson.id);
const teleprompterModal = getOrCreateElem('modal-tutor-teleprompter');
assert(!teleprompterModal.classList.contains('hidden'), 'Teleprompter modal is visible when launched');
const teleprompterContent = getOrCreateElem('teleprompter-content-container');
assert(teleprompterContent.innerHTML.includes('Be strong like a lion'), 'Teleprompter renders primary source quote');
assert(teleprompterContent.innerHTML.includes('supplements customs'), 'Teleprompter renders misconception watch out box');
assert(teleprompterContent.innerHTML.includes('set table and tablecloth'), 'Teleprompter renders secret cheat sheet');
assert(teleprompterContent.innerHTML.includes('Tur'), 'Teleprompter renders anchor checklist');

// Test Anchor Checklist Interactive Toggling
sandbox.toggleTeleprompterAnchorCheck(0);
const anchor0Text = getOrCreateElem('teleprompter-anchor-text-0');
assert(anchor0Text.classList.contains('line-through'), 'Toggling anchor marks it completed with line-through');

// Test Closing Teleprompter
sandbox.closeTutorTeleprompter();
assert(teleprompterModal.classList.contains('hidden'), 'Closing teleprompter hides modal');

// ==============================================
// GATE 17: DYNAMIC STUDENT CURRICULUM & LEGACY PURGE
// ==============================================
console.log('\n--- Gate 17: Dynamic Student Curriculum & Legacy Purge ---');

// 1. Function existence
assert(typeof sandbox.getStudentCourseProgress === 'function', 'getStudentCourseProgress is a function');
assert(typeof sandbox.purgeLegacyCurriculumData === 'function', 'purgeLegacyCurriculumData is a function');

// 2. Clean Canvas Zero Courses State
const testDynamicStudent = {
  id: 'stu_dynamic_test',
  name: 'Dynamic Student',
  completedTopics: {},
  completed_topics: {},
  skills: { customGoals: [], homework: { task: '' } }
};
sandbox.APP_STATE.students = [testDynamicStudent];
sandbox.APP_STATE.customCourses = [];

const zeroProgress = sandbox.getStudentCourseProgress(testDynamicStudent);
assert(zeroProgress.totalClasses === 0, 'Zero courses yields 0 totalClasses');
assert(zeroProgress.completedClasses === 0, 'Zero courses yields 0 completedClasses');
assert(zeroProgress.overallPct === 0, 'Zero courses yields 0% overallPct');

// Test renderStudents with zero courses
sandbox.renderStudents();
const studentListHtml = getOrCreateElem('students-list').innerHTML;
assert(!studentListHtml.includes('13 / 13') && !studentListHtml.includes('23 / 23'), 'Student card does NOT render hardcoded 13 or 23 totals');
assert(!studentListHtml.includes('No Parsha') && !studentListHtml.includes('ללא פרשה'), 'Student card does NOT render hardcoded No Parsha badge');
assert(studentListHtml.includes('0 Courses') || studentListHtml.includes('0 קורסים'), 'Student card displays active course count');

// 3. Dynamic Course Creation and Student Profile Binding
const testCustomCourse = {
  id: 'course_ai_prep',
  title_en: 'AI & Coding Fundamentals',
  title_he: 'יסודות AI ותכנות',
  icon: '💻',
  category: 'Computer Science',
  lessons: [
    { id: 'les_ai_1', lesson_num: 1, title_en: 'Intro to Neural Networks', title_he: 'מבוא לרשתות עצביות' },
    { id: 'les_ai_2', lesson_num: 2, title_en: 'Prompt Architecture', title_he: 'ארכיטקטורת הנחיות' }
  ]
};
sandbox.APP_STATE.customCourses = [testCustomCourse];

const initialProgress = sandbox.getStudentCourseProgress(testDynamicStudent);
assert(initialProgress.totalClasses === 2, 'Two classes recorded in student progress');
assert(initialProgress.completedClasses === 0, '0 classes completed initially');
assert(initialProgress.overallPct === 0, '0% overall completion');

// Mark Lesson 1 as completed for student
sandbox.toggleTopicForStudent(testDynamicStudent.id, 'course_ai_prep_les_ai_1', 'les_ai_1');
const updatedProgress = sandbox.getStudentCourseProgress(testDynamicStudent);
assert(updatedProgress.completedClasses === 1, 'Completed classes increments to 1');
assert(updatedProgress.overallPct === 50, 'Overall progress updates dynamically to 50%');

// Test renderStudents updates progress bar dynamically
sandbox.renderStudents();
const updatedListHtml = getOrCreateElem('students-list').innerHTML;
assert(updatedListHtml.includes('1 / 2') || updatedListHtml.includes('50%'), 'Student card renders dynamic 1 / 2 classes or 50%');

// 4. Test Student Drawer Rendering
const drawerDetailEl = getOrCreateElem('drawer-student-detail');
drawerDetailEl.classList.remove('hidden');
getOrCreateElem('drawer-header-content');
getOrCreateElem('drawer-body-content');
sandbox.openStudentDrawer(testDynamicStudent.id);
const drawerBodyHtml = getOrCreateElem('drawer-body-content').innerHTML;
assert(drawerBodyHtml.includes('Coding Fundamentals'), 'Student drawer renders educator custom course title');
assert(drawerBodyHtml.includes('Intro to Neural Networks'), 'Student drawer renders custom lesson title in checklist');
assert(!drawerBodyHtml.includes('Red Booklet') && !drawerBodyHtml.includes('חוברת אדומה'), 'Student drawer does NOT render old reading booklets');
assert(!drawerBodyHtml.includes('Aliyah 1') && !drawerBodyHtml.includes('עליה 1'), 'Student drawer does NOT render old ceremony aliyot');

// 5. Test Legacy Curriculum Purge
sandbox.APP_STATE.customCourses.push(
  { id: 'course_bar_mitzvah_concepts', title_en: 'Legacy Concepts', lessons: [] },
  { id: 'course_bar_mitzvah_chumash', title_en: 'Legacy Chumash', lessons: [] }
);
sandbox.purgeLegacyCurriculumData();
assert(!sandbox.APP_STATE.customCourses.some(c => c.id === 'course_bar_mitzvah_concepts'), 'purgeLegacyCurriculumData removed legacy concepts');
assert(!sandbox.APP_STATE.customCourses.some(c => c.id === 'course_bar_mitzvah_chumash'), 'purgeLegacyCurriculumData removed legacy chumash');

// 6. Test Curriculum Archive Files and Complete Clean Slate
assert(fs.existsSync('CURRICULUM_ARCHIVE_ALL_LESSONS.md'), 'CURRICULUM_ARCHIVE_ALL_LESSONS.md exists on disk');
assert(fs.existsSync('curriculum_backup_complete.json'), 'curriculum_backup_complete.json exists on disk');

const archiveContent = fs.readFileSync('CURRICULUM_ARCHIVE_ALL_LESSONS.md', 'utf8');
assert(archiveContent.includes('Shabbat (שבת קודש)'), 'Curriculum archive preserves Shabbat concept');
assert(archiveContent.includes('Parshat Bereishit'), 'Curriculum archive preserves Parshat Bereishit');
assert(archiveContent.includes('Parshat Shemot'), 'Curriculum archive preserves Parshat Shemot');

assert(typeof sandbox.handlePurgeAllCourses === 'function', 'handlePurgeAllCourses is a function');

// Test Courses Grid Clean Canvas Render
sandbox.APP_STATE.customCourses = [];
sandbox.renderCoursesCardsGrid();
const emptyGridHtml = getOrCreateElem('courses-cards-grid').innerHTML;
assert(emptyGridHtml.includes('Clean Canvas') || emptyGridHtml.includes('דף חלק'), 'Courses grid renders clean canvas placeholder when 0 courses');
assert(indexHtml.includes('id="btn-purge-all-courses"'), 'HTML contains btn-purge-all-courses element');

// ==============================================
// GATE 18: UNIVERSAL COURSE & CLASS BLUEPRINT ENGINE
// ==============================================
console.log('\n--- Gate 18: Universal Course & Class Blueprint Engine ---');

// 1. Function existence
assert(typeof sandbox.applyBlueprintPreset === 'function', 'applyBlueprintPreset is a function');
assert(typeof sandbox.addBlueprintSection === 'function', 'addBlueprintSection is a function');
assert(typeof sandbox.removeBlueprintSection === 'function', 'removeBlueprintSection is a function');
assert(typeof sandbox.updateBlueprintSectionName === 'function', 'updateBlueprintSectionName is a function');
assert(typeof sandbox.selectCourseColor === 'function', 'selectCourseColor is a function');
assert(typeof sandbox.handleAiSuggestBlueprint === 'function', 'handleAiSuggestBlueprint is a function');
assert(typeof sandbox.renderBlueprintSectionsList === 'function', 'renderBlueprintSectionsList is a function');
assert(typeof sandbox.renderDynamicClassFormFields === 'function', 'renderDynamicClassFormFields is a function');
assert(typeof sandbox.promptAddSectionToClass === 'function', 'promptAddSectionToClass is a function');

// 2. Blueprint Presets Behavior
sandbox.applyBlueprintPreset('blank');
assert(sandbox.getCurrentBlueprintSections().length === 2, 'blank preset provides 2 minimal starter sections');

sandbox.applyBlueprintPreset('torah_audio');
assert(sandbox.getCurrentBlueprintSections().length === 4, 'torah_audio preset generates 4 sections');
assert(sandbox.getCurrentBlueprintSections().some(s => s.name.includes('Parsha Verses') && s.type === 'text'), 'torah_audio includes Parsha Verses text section');
assert(sandbox.getCurrentBlueprintSections().some(s => s.type === 'audio'), 'torah_audio includes Trope Audio Recordings section');

sandbox.applyBlueprintPreset('reading_fluency');
assert(sandbox.getCurrentBlueprintSections().length === 4, 'reading_fluency preset generates 4 sections');
assert(sandbox.getCurrentBlueprintSections().some(s => s.name.includes('Reading') && s.type === 'text'), 'reading_fluency includes Reading Rule section');

// 3. Section Editing & Addition
sandbox.addBlueprintSection('list', 'Custom Practice Drills');
assert(sandbox.getCurrentBlueprintSections().length === 5, 'addBlueprintSection added 5th section');
const addedSec = sandbox.getCurrentBlueprintSections()[sandbox.getCurrentBlueprintSections().length - 1];
assert(addedSec.name === 'Custom Practice Drills', 'added section has correct name');

sandbox.updateBlueprintSectionName(addedSec.id, 'Updated Speed Drills');
assert(sandbox.getCurrentBlueprintSections().find(s => s.id === addedSec.id).name === 'Updated Speed Drills', 'updateBlueprintSectionName modified section name');

sandbox.removeBlueprintSection(addedSec.id);
assert(sandbox.getCurrentBlueprintSections().length === 4, 'removeBlueprintSection removed section');

// 4. Color Selection
sandbox.selectCourseColor('emerald');
const colorInput = getOrCreateElem('input-create-course-color');
assert(colorInput.value === 'emerald', 'selectCourseColor sets color input value to emerald');

// 5. Course Creation with Blueprint & Color
getOrCreateElem('input-create-course-title-en').value = 'Chumash with Trope';
getOrCreateElem('input-create-course-title-he').value = 'חומש עם טעמים';
getOrCreateElem('input-create-course-icon').value = '📜';
getOrCreateElem('input-create-course-desc').value = 'Master Torah chanting and storyline';
colorInput.value = 'amber';
sandbox.applyBlueprintPreset('torah_audio');

const mockEvent = { preventDefault() {} };
sandbox.handleSaveCustomCourse(mockEvent);

const blueprintCourse = (sandbox.APP_STATE.customCourses || []).find(c => c.title_en === 'Chumash with Trope');
assert(blueprintCourse, 'handleSaveCustomCourse successfully created course in customCourses');
assert(blueprintCourse.color === 'amber', 'Created course saved color amber');
assert(blueprintCourse.icon === '📜', 'Created course saved icon');
assert(blueprintCourse.blueprint && blueprintCourse.blueprint.sections.length === 4, 'Created course saved 4 blueprint sections');

// 6. Dynamic Class Field Rendering
sandbox.APP_STATE.insideCourseId = blueprintCourse.id;
sandbox.APP_STATE.activeCourseId = blueprintCourse.id;
sandbox.renderDynamicClassFormFields(blueprintCourse);

const dynamicFormContainer = getOrCreateElem('dynamic-course-lesson-sections');
assert(dynamicFormContainer.innerHTML.includes('Parsha Verses'), 'Dynamic class form renders Parsha Verses section label');
assert(dynamicFormContainer.innerHTML.includes('Audio Recordings'), 'Dynamic class form renders Audio Recordings section label');
assert(dynamicFormContainer.innerHTML.includes('Record Voice Memo'), 'Dynamic class form renders Audio Studio voice memo button');

// 7. AI Questionnaire and Class Assist
getOrCreateElem('input-ai-class-prompt').value = 'Parshat Bereishit - Creation';
getOrCreateElem('input-ai-class-details').value = 'Include Rashi on 1:1 and trope recording notes';
sandbox.handleAiClassAssist();

// Verify that dynamic section fields got populated
const versesInput = getOrCreateElem(`input-section-${blueprintCourse.blueprint.sections[0].id}`);
assert(versesInput.value.length > 0, 'AI Assist populated dynamic Parsha Verses input');

// 8. Class Saving with Blueprint Sections
getOrCreateElem('input-custom-lesson-title-en').value = 'Bereishit: Day One';
getOrCreateElem('input-custom-lesson-title-he').value = 'בראשית: יום ראשון';
sandbox.handleSaveCustomLesson(mockEvent);

assert(blueprintCourse.lessons.length === 1, 'Created course has 1 lesson');
const blueprintLesson = blueprintCourse.lessons[0];
assert(blueprintLesson.title_en === 'Bereishit: Day One', 'Saved lesson has correct title');
assert(blueprintLesson.sections && typeof blueprintLesson.sections === 'object', 'Saved lesson has sections object');
assert(blueprintLesson.sections[blueprintCourse.blueprint.sections[0].id], 'Saved lesson preserved dynamic section content');
assert(blueprintLesson.hook_en, 'Saved lesson preserved resolved hook fallback for compatibility');

// 9. Class Header & Custom Section Display inside Edit Lesson Studio
sandbox.APP_STATE.expandedCustomLessonIds[blueprintLesson.id] = true;
sandbox.enterStudioEditLessonMode(blueprintCourse.id, blueprintLesson.id);
const lessonsContainerHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;

assert(lessonsContainerHtml.includes('title="Edit Class"') || lessonsContainerHtml.includes('edit-2'), 'Class card header includes discreet Edit Class button');
assert(lessonsContainerHtml.includes('Teach') || lessonsContainerHtml.includes('presentation'), 'Class card header includes Teach button');
assert(lessonsContainerHtml.includes('Parsha Verses'), 'Expanded card displays custom blueprint section Parsha Verses');
assert(lessonsContainerHtml.includes('Audio & Voice Recordings'), 'Expanded card displays Audio Studio section');

// 10. Edit Class Modal Rehydration
sandbox.openEditCustomLessonModal(blueprintCourse.id, blueprintLesson.id);
const rehydratedInput = getOrCreateElem(`input-section-${blueprintCourse.blueprint.sections[0].id}`);
assert(rehydratedInput.value.length > 0, 'Edit modal rehydrated dynamic section field value');

// Gate 19: Classes Tab Renaming, Course-First Clean Slate Hierarchy, AI Blueprint & Extension Bridge
console.log('\n--- Gate 19: Classes Tab Renaming, Hierarchy & Extension Bridge ---');

// 1. Tab & Dock Renaming
assert(sandbox.I18N.en.tabStudy === 'Courses', 'I18N en tabStudy is Courses');
assert(sandbox.I18N.he.tabStudy === 'קורסים', 'I18N he tabStudy is קורסים');
assert(sandbox.I18N.en.mobStudy === 'Courses', 'I18N en mobStudy is Courses');
assert(sandbox.I18N.he.mobStudy === 'קורסים', 'I18N he mobStudy is קורסים');
assert(indexHtml.includes('id="mob-lbl-study">Courses<'), 'HTML mobile dock label is Courses');

// 2. Course-First Navigation & switchTab('classes') Alias
sandbox.switchTab('classes');
assert(sandbox.APP_STATE.activeTab === 'study', 'switchTab classes alias activates study tab');
assert(sandbox.APP_STATE.insideCourseId === null, 'Entering classes resets insideCourseId to null (Courses Directory)');

// 3. Clean Slate Onboarding Copy & Elements
assert(indexHtml.includes('Welcome to Classes'), 'HTML clean slate title welcomes educators to Classes');
assert(indexHtml.includes('+ Add a Course'), 'HTML clean slate contains prominent + Add a Course button');
assert(indexHtml.includes('id="lbl-courses-directory-title">My Courses<'), 'HTML courses directory header is My Courses');

// 4. Interactive AI Course Structure Assistant
assert(indexHtml.includes('id="input-ai-blueprint-prompt"'), 'HTML contains input-ai-blueprint-prompt');
assert(indexHtml.includes('id="btn-ai-blueprint-suggest"'), 'HTML contains btn-ai-blueprint-suggest');
assert(typeof sandbox.handleAiSuggestBlueprint === 'function', 'handleAiSuggestBlueprint is a function');

getOrCreateElem('input-ai-blueprint-prompt').value = 'Talmud Bava Metzia - Lost & Found Objects';
sandbox.handleAiSuggestBlueprint();
assert(getOrCreateElem('input-create-course-title-en').value.length > 0, 'AI populated course title');
assert(sandbox.getCurrentBlueprintSections().length >= 3, 'AI configured blueprint sections');

// 5. Chrome Extension & Web Clipper Bridge
assert(indexHtml.includes('id="btn-open-extension-bridge"'), 'HTML contains Web Clipper button');
assert(indexHtml.includes('id="modal-extension-bridge"'), 'HTML contains modal-extension-bridge');
assert(typeof sandbox.openExtensionBridgeModal === 'function', 'openExtensionBridgeModal is a function');
assert(typeof sandbox.closeExtensionBridgeModal === 'function', 'closeExtensionBridgeModal is a function');
assert(typeof sandbox.copyWebClipperBookmarklet === 'function', 'copyWebClipperBookmarklet is a function');
assert(typeof sandbox.checkUrlExtensionParams === 'function', 'checkUrlExtensionParams is a function');
assert(typeof sandbox.initExtensionBridge === 'function', 'initExtensionBridge is a function');

// 6. Extension postMessage Bridge Lesson Creation
sandbox.initExtensionBridge();
const msgListeners = sandbox.window._listeners['message'] || [];
assert(msgListeners.length > 0, 'initExtensionBridge registered message listener');

const extCourse = (sandbox.APP_STATE.customCourses || [])[0];
const initialLessonCount = extCourse && extCourse.lessons ? extCourse.lessons.length : 0;

msgListeners[0]({
  data: {
    action: 'TUTORPILOT_CREATE_LESSON',
    courseId: extCourse.id,
    title: 'Extension: Talmudic Gemara Text',
    text: 'Two hold a garment, one says it is all mine and one says it is all mine...'
  }
});

assert(extCourse.lessons.length === initialLessonCount + 1, 'Extension message successfully created a lesson');
const extLesson = extCourse.lessons[extCourse.lessons.length - 1];
assert(extLesson.title_en === 'Extension: Talmudic Gemara Text', 'Extension lesson title saved');
assert(extLesson.hook_en.includes('Two hold a garment') || Object.values(extLesson.sections || {}).some(v => String(v).includes('Two hold a garment')), 'Extension lesson saved clipped text');

// Gate 20: Universal Domain Neutrality & Secular Calendar Purification
console.log('\n--- Gate 20: Universal Domain Neutrality & Secular Calendar Purification ---');

// 1. I18N Student CRM Neutrality
assert(sandbox.I18N.en.addStudentModalTitle === 'Add New Student', 'I18N en student title is Add New Student');
assert(sandbox.I18N.en.parshaDropdownLabel === 'Primary Course / Subject', 'I18N en parsha label is Primary Course / Subject');
assert(sandbox.I18N.en.barMitzvahDateLabel === 'Grade Level / Target Date', 'I18N en date label is Grade Level / Target Date');
assert(sandbox.I18N.he.addStudentModalTitle === 'הוספת תלמיד חדש', 'I18N he student title is הוספת תלמיד חדש');
assert(sandbox.I18N.he.parshaDropdownLabel === 'קורס / מקצוע ראשי', 'I18N he parsha label is קורס / מקצוע ראשי');
assert(sandbox.I18N.he.barMitzvahDateLabel === 'שכבת גיל / תאריך יעד', 'I18N he date label is שכבת גיל / תאריך יעד');

// 2. HTML Student Modal & Hidden Fields Sanitization
assert(indexHtml.includes('id="txt-modal-student-title"') && indexHtml.includes('Add New Student'), 'HTML modal contains Add New Student');
assert(indexHtml.includes('id="lbl-student-parsha"') && indexHtml.includes('Primary Course / Subject'), 'HTML modal contains Primary Course / Subject label');
assert(indexHtml.includes('id="lbl-student-date"') && indexHtml.includes('Grade Level / Target Date'), 'HTML modal contains Grade Level / Target Date label');
assert(indexHtml.includes('id="input-create-course-category" value="General Curriculum"'), 'Course creation default category is General Curriculum');
assert(indexHtml.includes('id="input-create-course-level" value="Standard / All Levels"'), 'Course creation default level is Standard / All Levels');

// 3. Student Entity Subject & Grade Aliasing
getOrCreateElem('new-student-name').value = 'Sophia Miller';
getOrCreateElem('new-student-parsha-select').value = 'AP Physics 1';
getOrCreateElem('new-student-date').value = 'Grade 11';
getOrCreateElem('new-student-notes').value = 'Needs calculus review';

sandbox.handleCreateStudent({ preventDefault() {} });
const addedStudent = sandbox.APP_STATE.students.find(s => s.name === 'Sophia Miller');
assert(!!addedStudent, 'Created student found in APP_STATE');
assert(addedStudent.subject === 'AP Physics 1', 'Student stores subject field');
assert(addedStudent.gradeOrDate === 'Grade 11', 'Student stores gradeOrDate field');
assert(addedStudent.parsha === 'AP Physics 1', 'Student maintains parsha alias for compatibility');
assert(addedStudent.barMitzvahDate === 'Grade 11', 'Student maintains barMitzvahDate alias for compatibility');

const info = sandbox.getStudentSubjectAndDate ? sandbox.getStudentSubjectAndDate(addedStudent) : sandbox.getStudentParshaAndDate(addedStudent);
assert(info.subject === 'AP Physics 1', 'getStudentSubjectAndDate returns correct subject');
assert(info.gradeOrDate === 'Grade 11', 'getStudentSubjectAndDate returns correct gradeOrDate');

// 4. Secular Calendar Default & Hebrew Overlay Toggle
assert(sandbox.APP_STATE.enableHebrewCalendar === false, 'Secular Gregorian calendar is active by default');
assert(typeof sandbox.toggleHebrewCalendarOverlay === 'function', 'toggleHebrewCalendarOverlay is a function');
assert(indexHtml.includes('id="btn-toggle-hebrew-calendar"'), 'HTML contains btn-toggle-hebrew-calendar');
assert(indexHtml.includes('id="lbl-hebrew-calendar-toggle"'), 'HTML contains lbl-hebrew-calendar-toggle');
assert(indexHtml.includes('id="calendar-hebrew-month-year" class="text-xs font-semibold text-brand-400 font-mono px-2 py-1 rounded-lg bg-brand-500/10 border border-brand-500/20 hidden"'), 'Hebrew month badge is hidden by default');

sandbox.toggleHebrewCalendarOverlay();
assert(sandbox.APP_STATE.enableHebrewCalendar === true, 'Toggling turns Hebrew calendar overlay on');
sandbox.toggleHebrewCalendarOverlay();
assert(sandbox.APP_STATE.enableHebrewCalendar === false, 'Toggling again turns Hebrew calendar overlay off');

// 5. Schedule Modal & Studio Copy Neutrality
assert(indexHtml.includes('What to teach during this session? (Optional)'), 'Schedule modal topic label is universal');
assert(indexHtml.includes('e.g. Chapter 4 review, practice problem set'), 'Schedule modal topic placeholder is universal');
assert(indexHtml.includes('id="user-dropdown-school-name" class="truncate">My Tutoring Studio<'), 'User dropdown school placeholder is My Tutoring Studio');
assert(indexHtml.includes('id="school-display-name" class="text-base font-bold text-white">My Tutoring Studio<'), 'School settings display placeholder is My Tutoring Studio');

// 6. Gemini Tool Calling Domain Neutrality
const phase1ToolsDecl = sandbox.buildGeminiToolsDeclaration ? sandbox.buildGeminiToolsDeclaration() : [];
const toolList = (phase1ToolsDecl[0] && phase1ToolsDecl[0].functionDeclarations) ? phase1ToolsDecl[0].functionDeclarations : [];
const addStudentTool = toolList.find(t => t.name === 'add_student');
assert(!!addStudentTool, 'buildGeminiToolsDeclaration includes add_student');
assert(!!addStudentTool.parameters.properties.subject, 'add_student tool defines subject property');
assert(!!addStudentTool.parameters.properties.gradeOrDate, 'add_student tool defines gradeOrDate property');

// Execute AI Tool with universal subject and grade
sandbox.executeAiToolCall({
  name: 'add_student',
  args: {
    name: 'Marcus Vance',
    subject: 'AP World History',
    gradeOrDate: 'Grade 10',
    notes: 'Preparing for DBQ essay'
  }
});
const aiStudent = sandbox.APP_STATE.students.find(s => s.name === 'Marcus Vance');
assert(!!aiStudent, 'AI tool successfully created student');
assert(aiStudent.subject === 'AP World History', 'AI student created with universal subject');
assert(aiStudent.gradeOrDate === 'Grade 10', 'AI student created with universal gradeOrDate');
assert(aiStudent.parsha === 'AP World History', 'AI student preserves parsha alias');

sandbox.executeAiToolCall({
  name: 'update_student',
  args: {
    studentNameOrId: 'Marcus Vance',
    subject: 'AP European History',
    gradeOrDate: 'Grade 11'
  }
});
assert(aiStudent.subject === 'AP European History', 'AI tool successfully updated student subject');
assert(aiStudent.gradeOrDate === 'Grade 11', 'AI tool successfully updated student gradeOrDate');

// ==============================================
// GATE 21: PROFESSIONAL STUDENT CRM & ATTENDANCE TRACKING
// ==============================================
console.log('\n--- Gate 21: Professional Student CRM & Attendance Tracking ---');

// 1. HTML Markup & CRM Elements Presence
assert(indexHtml.includes('id="student-roster-filter-bar"'), 'HTML contains student-roster-filter-bar');
assert(indexHtml.includes('id="filter-btn-all"'), 'HTML contains filter-btn-all');
assert(indexHtml.includes('id="filter-btn-active"'), 'HTML contains filter-btn-active');
assert(indexHtml.includes('id="filter-btn-paused"'), 'HTML contains filter-btn-paused');
assert(indexHtml.includes('id="filter-btn-completed"'), 'HTML contains filter-btn-completed');
assert(indexHtml.includes('id="modal-parent-recap"'), 'HTML contains modal-parent-recap');
assert(indexHtml.includes('id="recap-message-textarea"'), 'HTML contains recap-message-textarea');
assert(indexHtml.includes('id="new-student-grade-level"'), 'HTML contains new-student-grade-level select');
assert(indexHtml.includes('id="new-student-status"'), 'HTML contains new-student-status select');
assert(indexHtml.includes('id="new-student-guardian-name"'), 'HTML contains new-student-guardian-name input');
assert(indexHtml.includes('id="new-student-guardian-phone"'), 'HTML contains new-student-guardian-phone input');
assert(indexHtml.includes('id="new-student-guardian-email"'), 'HTML contains new-student-guardian-email input');
assert(indexHtml.includes('id="new-student-hourly-rate"'), 'HTML contains new-student-hourly-rate input');

// 2. Student Creation with Universal CRM Schema
getOrCreateElem('new-student-name').value = 'Liam Chen';
getOrCreateElem('new-student-parsha-select').value = 'AP Chemistry';
getOrCreateElem('new-student-date').value = 'June 2026';
getOrCreateElem('new-student-grade-level').value = 'High School (9th - 12th)';
getOrCreateElem('new-student-status').value = 'active';
getOrCreateElem('new-student-guardian-name').value = 'Mei Chen';
getOrCreateElem('new-student-guardian-phone').value = '+1 555-0144';
getOrCreateElem('new-student-guardian-email').value = 'mei.chen@example.com';
getOrCreateElem('new-student-hourly-rate').value = '$75/hr';
getOrCreateElem('new-student-notes').value = 'Focusing on thermodynamics';

sandbox.handleCreateStudent({ preventDefault() {} });
const liamStudent = sandbox.APP_STATE.students.find(s => s.name === 'Liam Chen');
assert(!!liamStudent, 'Liam Chen created in APP_STATE');
assert(liamStudent.gradeLevel === 'High School (9th - 12th)', 'Student stores gradeLevel field');
assert(liamStudent.status === 'active', 'Student stores status field');
assert(liamStudent.parentContact && liamStudent.parentContact.name === 'Mei Chen', 'Student stores guardian name');
assert(liamStudent.parentContact && liamStudent.parentContact.phone === '+1 555-0144', 'Student stores guardian phone');
assert(liamStudent.parentContact && liamStudent.parentContact.email === 'mei.chen@example.com', 'Student stores guardian email');
assert(liamStudent.hourlyRate === '$75/hr', 'Student stores hourlyRate field');

// 3. Roster Status Filtering & Counter Badges
assert(typeof sandbox.setStudentRosterFilter === 'function', 'setStudentRosterFilter is a function');

// Create a paused student and a completed student for filtering verification
const pausedStudent = {
  id: 'stu_paused_1',
  name: 'Noah Patel',
  status: 'paused',
  gradeLevel: 'College / University',
  parentContact: { name: 'Anita Patel', phone: '+1 555-0188', email: 'anita@example.com' },
  hourlyRate: '$80/hr',
  schedule: [],
  skills: sandbox.getDefaultStudentSkills()
};
const completedStudent = {
  id: 'stu_completed_1',
  name: 'Chloe Davis',
  status: 'completed',
  gradeLevel: 'High School (9th - 12th)',
  parentContact: { name: 'Mark Davis', phone: '+1 555-0199', email: 'mark@example.com' },
  hourlyRate: '$70/hr',
  schedule: [],
  skills: sandbox.getDefaultStudentSkills()
};
sandbox.APP_STATE.students.push(pausedStudent, completedStudent);

sandbox.setStudentRosterFilter('active');
assert(sandbox.APP_STATE.studentRosterFilter === 'active', 'Filter set to active');
sandbox.renderStudents();
let rosterHtml = getOrCreateElem('students-list').innerHTML;
assert(rosterHtml.includes('Liam Chen'), 'Active filter displays active student Liam');
assert(!rosterHtml.includes('Noah Patel'), 'Active filter hides paused student Noah');
assert(!rosterHtml.includes('Chloe Davis'), 'Active filter hides completed student Chloe');

sandbox.setStudentRosterFilter('paused');
sandbox.renderStudents();
rosterHtml = getOrCreateElem('students-list').innerHTML;
assert(!rosterHtml.includes('Liam Chen'), 'Paused filter hides active student Liam');
assert(rosterHtml.includes('Noah Patel'), 'Paused filter displays paused student Noah');

sandbox.setStudentRosterFilter('completed');
sandbox.renderStudents();
rosterHtml = getOrCreateElem('students-list').innerHTML;
assert(rosterHtml.includes('Chloe Davis'), 'Completed filter displays completed student Chloe');

sandbox.setStudentRosterFilter('all');
sandbox.renderStudents();
rosterHtml = getOrCreateElem('students-list').innerHTML;
assert(rosterHtml.includes('Liam Chen') && rosterHtml.includes('Noah Patel') && rosterHtml.includes('Chloe Davis'), 'All filter displays all students');

// 4. Student Drawer CRM Card & Inline Updates
sandbox.openStudentDrawer(liamStudent.id);
const crmDrawerHtml = getOrCreateElem('drawer-body-content').innerHTML;
assert(crmDrawerHtml.includes('Mei Chen'), 'Drawer renders guardian name');
assert(crmDrawerHtml.includes('+1 555-0144'), 'Drawer renders guardian phone');
assert(crmDrawerHtml.includes('mei.chen@example.com'), 'Drawer renders guardian email');
assert(crmDrawerHtml.includes('$75/hr'), 'Drawer renders hourly rate');
assert(crmDrawerHtml.includes('wa.me/15550144'), 'Drawer renders 1-click WhatsApp link');
assert(crmDrawerHtml.includes('tel:+1 555-0144'), 'Drawer renders 1-click Call link');
assert(crmDrawerHtml.includes('mailto:mei.chen@example.com'), 'Drawer renders 1-click Email link');

// Test inline updating
assert(typeof sandbox.updateStudentDrawerField === 'function', 'updateStudentDrawerField is a function');
assert(typeof sandbox.updateStudentDrawerGuardianField === 'function', 'updateStudentDrawerGuardianField is a function');

sandbox.updateStudentDrawerField(liamStudent.id, 'hourlyRate', '$85/hr');
assert(liamStudent.hourlyRate === '$85/hr', 'updateStudentDrawerField updated hourlyRate to $85/hr');

sandbox.updateStudentDrawerGuardianField(liamStudent.id, 'phone', '+1 555-9999');
assert(liamStudent.parentContact.phone === '+1 555-9999', 'updateStudentDrawerGuardianField updated guardian phone');

// 5. Attendance & Session Logging
liamStudent.schedule = [
  { id: 'sess_chem_1', dateStr: '2026-11-20', time: '5:00 PM', topic: 'Thermodynamics & Kinetics', status: 'scheduled' }
];

assert(typeof sandbox.updateSessionAttendance === 'function', 'updateSessionAttendance is a function');

// Transition to completed
sandbox.updateSessionAttendance(liamStudent.id, 'sess_chem_1', 'completed');
assert(liamStudent.schedule[0].status === 'completed', 'Session status updated to completed');
assert(typeof liamStudent.schedule[0].completedAt === 'string', 'completedAt timestamp recorded on session completion');

// Transition to cancelled
sandbox.updateSessionAttendance(liamStudent.id, 'sess_chem_1', 'cancelled');
assert(liamStudent.schedule[0].status === 'cancelled', 'Session status updated to cancelled');
assert(liamStudent.schedule[0].completedAt === null, 'completedAt cleared on cancellation');

// Transition to no_show
sandbox.updateSessionAttendance(liamStudent.id, 'sess_chem_1', 'no_show');
assert(liamStudent.schedule[0].status === 'no_show', 'Session status updated to no_show');

// Day Cell Rendering with Attendance Styles
const dayCellCompletedHtml = sandbox.renderDayCell(20, '', true, false, '2026-11-20', 5, [
  { ...liamStudent.schedule[0], status: 'completed', studentName: 'Liam Chen', studentAvatar: '' }
]);
assert(dayCellCompletedHtml.includes('✓'), 'renderDayCell renders checkmark for completed session');
assert(dayCellCompletedHtml.includes('emerald'), 'renderDayCell applies emerald styling for completed session');

const dayCellNoShowHtml = sandbox.renderDayCell(20, '', true, false, '2026-11-20', 5, [
  { ...liamStudent.schedule[0], status: 'no_show', studentName: 'Liam Chen', studentAvatar: '' }
]);
assert(dayCellNoShowHtml.includes('⚠'), 'renderDayCell renders warning icon for no_show session');

// 6. Automated 1-Tap Parent Lesson Recap
assert(typeof sandbox.generateParentRecapText === 'function', 'generateParentRecapText is a function');
const recapEn = sandbox.generateParentRecapText(liamStudent, liamStudent.schedule[0]);
assert(recapEn.includes('Liam Chen'), 'English recap note includes student name');
assert(recapEn.includes('Thermodynamics & Kinetics'), 'English recap note includes session topic');
assert(recapEn.includes('Status:'), 'English recap note includes status label');

sandbox.APP_STATE.lang = 'he';
const recapHe = sandbox.generateParentRecapText(liamStudent, liamStudent.schedule[0]);
assert(recapHe.includes('Liam Chen'), 'Hebrew recap note includes student name');
assert(recapHe.includes('עדכון קצר על השיעור'), 'Hebrew recap note includes Hebrew header');
sandbox.APP_STATE.lang = 'en';

assert(typeof sandbox.openParentRecapModal === 'function', 'openParentRecapModal is a function');
assert(typeof sandbox.closeParentRecapModal === 'function', 'closeParentRecapModal is a function');
assert(typeof sandbox.copyParentRecapText === 'function', 'copyParentRecapText is a function');
assert(typeof sandbox.sendParentRecapWhatsApp === 'function', 'sendParentRecapWhatsApp is a function');
assert(typeof sandbox.sendParentRecapEmail === 'function', 'sendParentRecapEmail is a function');

sandbox.openParentRecapModal(liamStudent.id, 'sess_chem_1');
assert(sandbox.APP_STATE.activeRecapSession.sessionId === 'sess_chem_1', 'activeRecapSession recorded in APP_STATE');
assert(!getOrCreateElem('modal-parent-recap').classList.contains('hidden'), 'modal-parent-recap is unhidden');
assert(getOrCreateElem('recap-message-textarea').value.includes('Liam Chen'), 'Recap textarea populated with note');

sandbox.closeParentRecapModal();
assert(sandbox.APP_STATE.activeRecapSession === null, 'activeRecapSession reset to null on modal close');

// 7. Multi-Model AI Tool Calling for CRM & Attendance
const phase2ToolsDecl = sandbox.buildGeminiToolsDeclaration ? sandbox.buildGeminiToolsDeclaration() : [];
const p2ToolList = (phase2ToolsDecl[0] && phase2ToolsDecl[0].functionDeclarations) ? phase2ToolsDecl[0].functionDeclarations : [];

const p2AddStudentTool = p2ToolList.find(t => t.name === 'add_student');
assert(!!p2AddStudentTool.parameters.properties.gradeLevel, 'add_student tool declares gradeLevel');
assert(!!p2AddStudentTool.parameters.properties.status, 'add_student tool declares status');
assert(!!p2AddStudentTool.parameters.properties.guardianName, 'add_student tool declares guardianName');
assert(!!p2AddStudentTool.parameters.properties.guardianPhone, 'add_student tool declares guardianPhone');
assert(!!p2AddStudentTool.parameters.properties.hourlyRate, 'add_student tool declares hourlyRate');

const p2UpdateStudentTool = p2ToolList.find(t => t.name === 'update_student');
assert(!!p2UpdateStudentTool.parameters.properties.gradeLevel, 'update_student tool declares gradeLevel');
assert(!!p2UpdateStudentTool.parameters.properties.status, 'update_student tool declares status');
assert(!!p2UpdateStudentTool.parameters.properties.guardianName, 'update_student tool declares guardianName');
assert(!!p2UpdateStudentTool.parameters.properties.hourlyRate, 'update_student tool declares hourlyRate');

const logAttendanceTool = p2ToolList.find(t => t.name === 'log_session_attendance');
assert(!!logAttendanceTool, 'buildGeminiToolsDeclaration declares log_session_attendance tool');
assert(!!logAttendanceTool.parameters.properties.studentNameOrId, 'log_session_attendance requires studentNameOrId');
assert(!!logAttendanceTool.parameters.properties.date, 'log_session_attendance requires date');
assert(!!logAttendanceTool.parameters.properties.status, 'log_session_attendance requires status');

// Execute add_student with full CRM fields via AI Tool Call
sandbox.executeAiToolCall({
  name: 'add_student',
  args: {
    name: 'Emma Watson',
    subject: 'AP English Literature',
    gradeLevel: 'High School (9th - 12th)',
    status: 'active',
    guardianName: 'Chris Watson',
    guardianPhone: '+1 555-4321',
    guardianEmail: 'chris.watson@example.com',
    hourlyRate: '$90/hr',
    notes: 'Preparing for AP exam essay sections'
  }
});

const emmaStudent = sandbox.APP_STATE.students.find(s => s.name === 'Emma Watson');
assert(!!emmaStudent, 'AI tool created Emma Watson in APP_STATE');
assert(emmaStudent.gradeLevel === 'High School (9th - 12th)', 'AI created student with gradeLevel');
assert(emmaStudent.status === 'active', 'AI created student with status active');
assert(emmaStudent.hourlyRate === '$90/hr', 'AI created student with hourlyRate $90/hr');
assert(emmaStudent.parentContact.name === 'Chris Watson', 'AI created student with guardian name');
assert(emmaStudent.parentContact.phone === '+1 555-4321', 'AI created student with guardian phone');
assert(emmaStudent.parentContact.email === 'chris.watson@example.com', 'AI created student with guardian email');

// Execute update_student with CRM fields via AI Tool Call
sandbox.executeAiToolCall({
  name: 'update_student',
  args: {
    studentNameOrId: 'Emma Watson',
    status: 'paused',
    hourlyRate: '$95/hr',
    guardianPhone: '+1 555-8888'
  }
});
assert(emmaStudent.status === 'paused', 'AI tool updated status to paused');
assert(emmaStudent.hourlyRate === '$95/hr', 'AI tool updated hourlyRate to $95/hr');
assert(emmaStudent.parentContact.phone === '+1 555-8888', 'AI tool updated guardian phone');

// Execute log_session_attendance via AI Tool Call
sandbox.executeAiToolCall({
  name: 'log_session_attendance',
  args: {
    studentNameOrId: 'Emma Watson',
    date: '2026-11-25',
    status: 'completed',
    notes: 'Analyzed King Lear Act III'
  }
});
const emmaSession = emmaStudent.schedule.find(s => s.dateStr === '2026-11-25');
assert(!!emmaSession, 'AI log_session_attendance created session entry on date');
assert(emmaSession.status === 'completed', 'AI session attendance set to completed');
assert(typeof emmaSession.completedAt === 'string', 'AI session attendance recorded completedAt');
assert(emmaSession.topic.includes('King Lear'), 'AI session notes preserved in session topic');

// ==============================================
// Gate 22: Legacy Classes Disconnection and Second Brain Archival Verification
// ==============================================
console.log('\n--- Gate 22: Legacy Classes Disconnection & Second Brain Archival ---');

// 1. Second Brain JSON Archive Verification
const sbJsonPath1 = '/Users/dev/Documents/Antigravity second Brain/01_Projects/TutorPilot/BAR_MITZVAH_COMPLETE_CURRICULUM_ARCHIVE.json';
const sbJsonPath2 = '/Users/dev/Documents/Antigravity second Brain/04_Archive/BAR_MITZVAH_COMPLETE_CURRICULUM_ARCHIVE.json';

assert(fs.existsSync(sbJsonPath1), 'Second Brain TutorPilot JSON archive exists');
assert(fs.existsSync(sbJsonPath2), 'Second Brain 04_Archive JSON archive exists');

const sbData1 = JSON.parse(fs.readFileSync(sbJsonPath1, 'utf8'));
assert(sbData1.counts.jewish_concepts === 13, 'Second Brain archive records 13 Jewish Concepts');
assert(sbData1.counts.total_parshiot === 23, 'Second Brain archive records 23 Chumash Parshiot');
assert(sbData1.counts.total_lessons === 36, 'Second Brain archive records 36 total lessons');
assert(sbData1.counts.reading_booklets === 4, 'Second Brain archive records 4 leveled reading booklets');
assert(sbData1.counts.speech_milestones === 5, 'Second Brain archive records 5 speech milestones');

// 2. Second Brain Markdown Archive Verification
const sbMdPath1 = '/Users/dev/Documents/Antigravity second Brain/01_Projects/TutorPilot/BAR_MITZVAH_COMPLETE_CURRICULUM_ARCHIVE.md';
assert(fs.existsSync(sbMdPath1), 'Second Brain TutorPilot Markdown archive exists');
const sbMdContent = fs.readFileSync(sbMdPath1, 'utf8');
assert(sbMdContent.length > 80000, 'Second Brain Markdown archive contains exhaustive lesson text (>80KB)');
assert(sbMdContent.includes('Shabbat (שבת קודש)'), 'Markdown archive contains Shabbat lesson');
assert(sbMdContent.includes('Red Booklet'), 'Markdown archive contains Red Booklet reading unit');
assert(sbMdContent.includes('Topic & Theme Selection'), 'Markdown archive contains speech milestones');

// 3. HTML Permanent Hidden Style Verification
assert(indexHtml.includes('id="study-section-concepts" class="hidden" style="display: none !important;"'), 'study-section-concepts has permanent display: none !important');
assert(indexHtml.includes('id="study-section-chumash" class="hidden" style="display: none !important;"'), 'study-section-chumash has permanent display: none !important');

// 4. Classes Tab Switch Isolation Verification
const conceptsContainer = getOrCreateElem('study-section-concepts');
const chumashContainer = getOrCreateElem('study-section-chumash');
conceptsContainer.classList.add('hidden');
chumashContainer.classList.add('hidden');

// Inject legacy courses into APP_STATE
sandbox.APP_STATE.customCourses = [
  { id: 'course_bar_mitzvah_concepts', title_en: 'Bar Mitzvah: 13 Core Jewish Concepts', lessons: [] },
  { id: 'course_bar_mitzvah_chumash', title_en: 'Bar Mitzvah: Chumash', lessons: [] }
];

// Switch to Classes / Study tab
sandbox.switchTab('study');

// Verify legacy containers remain strictly hidden
assert(conceptsContainer.classList.contains('hidden'), 'switchTab(study) maintains study-section-concepts hidden');
assert(chumashContainer.classList.contains('hidden'), 'switchTab(study) maintains study-section-chumash hidden');

// Verify purgeLegacyCurriculumData wiped legacy courses on tab switch
assert(!sandbox.APP_STATE.customCourses.some(c => c.id.startsWith('course_bar_mitzvah')), 'switchTab(study) purged legacy Bar Mitzvah courses from customCourses');

// 5. Clean Slate Display Verification
const blankStateElem = getOrCreateElem('tutor-hub-blank-state');
sandbox.renderLessonsCategoryView();
assert(!blankStateElem.classList.contains('hidden'), 'Clean slate welcome canvas is displayed when tutor has 0 courses');

// 6. Template Loader Disconnection Verification
sandbox.handleLoadStarterBarMitzvahTemplate();
assert(!sandbox.APP_STATE.customCourses.some(c => c.id.startsWith('course_bar_mitzvah')), 'handleLoadStarterBarMitzvahTemplate does NOT load Bar Mitzvah courses into site');

// ==============================================
// Gate 23: Unified "Build Your Course" & Progressive Top Bar Actions
// ==============================================
console.log('\n--- Gate 23: Unified Build Your Course & Progressive Top Bar Actions ---');

// 1. HTML Verification of Unified Studio Elements
assert(indexHtml.includes('id="lbl-tutor-hub-title"'), 'HTML contains lbl-tutor-hub-title');
assert(indexHtml.includes('Build Your Courses'), 'HTML includes "Build Your Courses" header in empty state');
assert(indexHtml.includes('id="btn-course-builder-tab-ai"'), 'HTML contains btn-course-builder-tab-ai');
assert(indexHtml.includes('id="btn-course-builder-tab-manual"'), 'HTML contains btn-course-builder-tab-manual');
assert(indexHtml.includes('id="panel-course-builder-ai"'), 'HTML contains panel-course-builder-ai');
assert(indexHtml.includes('id="panel-course-builder-manual"'), 'HTML contains panel-course-builder-manual');
assert(indexHtml.includes('id="input-ai-blueprint-prompt"'), 'HTML contains input-ai-blueprint-prompt');
assert(indexHtml.includes('id="btn-ai-blueprint-suggest"'), 'HTML contains btn-ai-blueprint-suggest');
assert(indexHtml.includes('id="btn-ai-generate-full-course"'), 'HTML contains btn-ai-generate-full-course');
assert(indexHtml.includes('id="ai-builder-level-unified"'), 'HTML contains ai-builder-level-unified');
assert(indexHtml.includes('id="ai-builder-lessons-count-unified"'), 'HTML contains ai-builder-lessons-count-unified');
assert(indexHtml.includes('id="ai-builder-language-unified"'), 'HTML contains ai-builder-language-unified');
assert(indexHtml.includes('id="ai-suggested-preview-card"'), 'HTML contains ai-suggested-preview-card');
assert(indexHtml.includes('id="btn-top-add-course"'), 'HTML contains btn-top-add-course');

// 2. Separate Floating AI Studio Button Eliminated from Blank State
const blankStateDom = getOrCreateElem('tutor-hub-blank-state');
assert(!blankStateDom.innerHTML.includes('id="btn-ai-curriculum-studio"'), 'Blank state eliminates separate floating AI studio button');

// 3. Top Actions Bar Progressive Visibility
// When courses = 0: top actions bar is hidden
sandbox.APP_STATE.customCourses = [];
sandbox.renderCoursesCardsGrid();
const topActionsBar = getOrCreateElem('courses-directory-top-actions');
assert(topActionsBar.classList.contains('hidden'), 'courses-directory-top-actions is hidden when 0 courses exist');

// When courses exist: top actions bar is unhidden
sandbox.APP_STATE.customCourses = [
  { id: 'course_physics_101', title_en: 'Physics 101', lessons: [] }
];
sandbox.renderCoursesCardsGrid();
assert(!topActionsBar.classList.contains('hidden'), 'courses-directory-top-actions is unhidden when courses exist');

// 4. Mode Switcher Functions
assert(typeof sandbox.switchCourseBuilderMode === 'function', 'switchCourseBuilderMode is a function');
assert(typeof sandbox.setAiCoursePrompt === 'function', 'setAiCoursePrompt is a function');
assert(typeof sandbox.handleGenerateFullCourseFromAi === 'function', 'handleGenerateFullCourseFromAi is a function');

// Test Switch to Manual Mode
sandbox.switchCourseBuilderMode('manual');
const aiPanel = getOrCreateElem('panel-course-builder-ai');
const manualPanel = getOrCreateElem('panel-course-builder-manual');
assert(aiPanel.classList.contains('hidden'), 'AI panel is hidden in manual mode');
assert(!manualPanel.classList.contains('hidden'), 'Manual panel is visible in manual mode');

// Test Switch to AI Mode
sandbox.switchCourseBuilderMode('ai');
assert(!aiPanel.classList.contains('hidden'), 'AI panel is visible in AI mode');
assert(manualPanel.classList.contains('hidden'), 'Manual panel is hidden in AI mode');

// 5. openCreateCourseModal Defaults to AI Discussion Mode
sandbox.openCreateCourseModal();
const modalCreate = getOrCreateElem('modal-create-course');
assert(!modalCreate.classList.contains('hidden'), 'openCreateCourseModal unhides modal-create-course');
assert(!aiPanel.classList.contains('hidden'), 'openCreateCourseModal defaults to AI discussion mode');

// 6. setAiCoursePrompt Sets Prompt Value
sandbox.setAiCoursePrompt('AP Chemistry Lab');
const promptInput = getOrCreateElem('input-ai-blueprint-prompt');
assert(promptInput.value === 'AP Chemistry Lab', 'setAiCoursePrompt sets input-ai-blueprint-prompt value');

// 7. Transition Directly to Course & Lessons upon Course Creation
sandbox.APP_STATE.insideCourseId = null;
sandbox.openCourseClassesView('course_physics_101');
assert(sandbox.APP_STATE.insideCourseId === 'course_physics_101', 'openCourseClassesView sets insideCourseId');
const g23LevelClassesElem = getOrCreateElem('study-level-classes');
const g23LevelCoursesElem = getOrCreateElem('study-level-courses');
assert(!g23LevelClassesElem.classList.contains('hidden'), 'study-level-classes is visible for lesson creation');
assert(g23LevelCoursesElem.classList.contains('hidden'), 'study-level-courses is hidden when inside course');

// ==============================================
// Gate 24: Calendar Week Timetable, Quick Slot Booking & .ics Sync
// ==============================================
console.log('\n--- Gate 24: Calendar Week Timetable, Quick Slot Booking & .ics Sync ---');

// 1. HTML Verification of Week View & Sync Controls
assert(indexHtml.includes('id="btn-calendar-view-month"'), 'HTML contains btn-calendar-view-month');
assert(indexHtml.includes('id="btn-calendar-view-week"'), 'HTML contains btn-calendar-view-week');
assert(indexHtml.includes('id="btn-export-calendar-ics"'), 'HTML contains btn-export-calendar-ics');
assert(indexHtml.includes('id="calendar-month-view-container"'), 'HTML contains calendar-month-view-container');
assert(indexHtml.includes('id="calendar-week-view-container"'), 'HTML contains calendar-week-view-container');
assert(indexHtml.includes('id="calendar-week-timetable"'), 'HTML contains calendar-week-timetable');

// 2. Function Existence
assert(typeof sandbox.switchCalendarViewMode === 'function', 'switchCalendarViewMode is a function');
assert(typeof sandbox.renderWeekTimetable === 'function', 'renderWeekTimetable is a function');
assert(typeof sandbox.changeCalendarWeek === 'function', 'changeCalendarWeek is a function');
assert(typeof sandbox.parseTimeToHoursAndMinutes === 'function', 'parseTimeToHoursAndMinutes is a function');
assert(typeof sandbox.getWeekStartDate === 'function', 'getWeekStartDate is a function');
assert(typeof sandbox.formatDateToYMD === 'function', 'formatDateToYMD is a function');
assert(typeof sandbox.generateIcsCalendarString === 'function', 'generateIcsCalendarString is a function');
assert(typeof sandbox.exportCalendarToIcs === 'function', 'exportCalendarToIcs is a function');

// 3. Time Parsing Accuracy
const t1 = sandbox.parseTimeToHoursAndMinutes('4:30 PM');
assert(t1.hours === 16 && t1.minutes === 30, 'parseTimeToHoursAndMinutes parses 4:30 PM to 16:30');

const t2 = sandbox.parseTimeToHoursAndMinutes('9:00 AM');
assert(t2.hours === 9 && t2.minutes === 0, 'parseTimeToHoursAndMinutes parses 9:00 AM to 09:00');

const t3 = sandbox.parseTimeToHoursAndMinutes('12:00 PM');
assert(t3.hours === 12 && t3.minutes === 0, 'parseTimeToHoursAndMinutes parses 12:00 PM to 12:00');

const t4 = sandbox.parseTimeToHoursAndMinutes('12:00 AM');
assert(t4.hours === 0 && t4.minutes === 0, 'parseTimeToHoursAndMinutes parses 12:00 AM to 00:00');

const t5 = sandbox.parseTimeToHoursAndMinutes('14:45');
assert(t5.hours === 14 && t5.minutes === 45, 'parseTimeToHoursAndMinutes parses 24h 14:45 to 14:45');

// 4. Week Calculation Logic
const testDate = new Date(2026, 10, 12); // Thursday Nov 12, 2026
const weekSun = sandbox.getWeekStartDate(testDate);
assert(weekSun.getDay() === 0, 'getWeekStartDate returns a Sunday');
assert(weekSun.getDate() === 8, 'Nov 12 2026 week start is Sunday Nov 8');

sandbox.APP_STATE.calendar.currentWeekStart = weekSun;
sandbox.changeCalendarWeek(1);
const nextWeekSun = new Date(sandbox.APP_STATE.calendar.currentWeekStart);
assert(nextWeekSun.getDate() === 15, 'changeCalendarWeek(1) advances to next Sunday Nov 15');

sandbox.changeCalendarWeek(-1);
const prevWeekSun = new Date(sandbox.APP_STATE.calendar.currentWeekStart);
assert(prevWeekSun.getDate() === 8, 'changeCalendarWeek(-1) returns to Sunday Nov 8');

// 5. Calendar View Mode Switching
sandbox.switchCalendarViewMode('week');
assert(sandbox.APP_STATE.calendar.viewMode === 'week', 'switchCalendarViewMode sets viewMode to week');
const g24MonthContainer = getOrCreateElem('calendar-month-view-container');
const g24WeekContainer = getOrCreateElem('calendar-week-view-container');
assert(g24MonthContainer.classList.contains('hidden'), 'Month container is hidden in week mode');
assert(!g24WeekContainer.classList.contains('hidden'), 'Week container is visible in week mode');

sandbox.switchCalendarViewMode('month');
assert(sandbox.APP_STATE.calendar.viewMode === 'month', 'switchCalendarViewMode sets viewMode to month');
assert(!g24MonthContainer.classList.contains('hidden'), 'Month container is visible in month mode');
assert(g24WeekContainer.classList.contains('hidden'), 'Week container is hidden in month mode');

// 6. Week Timetable Rendering with Session Integration
sandbox.switchCalendarViewMode('week');
sandbox.APP_STATE.students = [
  {
    id: 'student_sarah_101',
    name: 'Sarah Connor',
    schedule: [
      { id: 'sess_sarah_1', dateStr: '2026-11-10', time: '3:00 PM', topic: 'Calculus Derivatives', status: 'completed' },
      { id: 'sess_sarah_2', dateStr: '2026-11-12', time: '5:00 PM', topic: 'Integration by Parts', status: 'scheduled' }
    ]
  }
];
sandbox.renderWeekTimetable();
const g24TimetableHtml = getOrCreateElem('calendar-week-timetable').innerHTML;
assert(g24TimetableHtml.includes('Sarah Connor'), 'Week timetable renders student name');
assert(g24TimetableHtml.includes('Calculus Derivatives'), 'Week timetable renders session topic');
assert(g24TimetableHtml.includes('3:00 PM'), 'Week timetable renders session time');
assert(g24TimetableHtml.includes('openScheduleLessonModal'), 'Week timetable contains open slot click handlers');

// 7. Quick Slot Scheduling from Open Hour
sandbox.openScheduleLessonModal('2026-11-12', null, '2:00 PM');
assert(sandbox.APP_STATE.calendar.selectedDateStr === '2026-11-12', 'openScheduleLessonModal sets selected date');
assert(sandbox.APP_STATE.calendar.selectedTimeSlot === '2:00 PM', 'openScheduleLessonModal sets selected time slot');
assert(sandbox.APP_STATE.calendar.isAddFormVisible === true, 'openScheduleLessonModal automatically expands booking form');
const g24ScheduleModal = getOrCreateElem('modal-schedule-lesson');
assert(!g24ScheduleModal.classList.contains('hidden'), 'Schedule lesson modal is unhidden on quick slot click');

// 8. RFC 5545 iCalendar (.ics) String Generation
const icsOutput = sandbox.generateIcsCalendarString();
assert(icsOutput.includes('BEGIN:VCALENDAR'), 'ICS contains BEGIN:VCALENDAR');
assert(icsOutput.includes('VERSION:2.0'), 'ICS specifies VERSION:2.0');
assert(icsOutput.includes('PRODID:-//TutorPilot//TutorPilot Schedule//EN'), 'ICS specifies PRODID');
assert(icsOutput.includes('BEGIN:VEVENT'), 'ICS contains BEGIN:VEVENT');
assert(icsOutput.includes('Sarah Connor: Calculus Derivatives'), 'ICS summary includes student and topic');
assert(icsOutput.includes('STATUS:CONFIRMED'), 'ICS declares confirmed status');
assert(icsOutput.includes('END:VEVENT'), 'ICS contains END:VEVENT');
assert(icsOutput.includes('END:VCALENDAR'), 'ICS concludes with END:VCALENDAR');

// ==============================================
// Gate 25: Teacher Command Center, Pedagogical AI & Printable Lesson Plans (Phase 4)
// ==============================================
console.log('\n--- Gate 25: Teacher Command Center, Pedagogical AI & Printable Plans ---');

// 1. HTML Verification of Phase 4 Cockpit & Modals
assert(indexHtml.includes('id="educator-command-center"'), 'HTML contains educator-command-center');
assert(indexHtml.includes('id="btn-top-command-center-trigger"'), 'HTML contains subtle top command-center trigger pill');
assert(indexHtml.includes('id="btn-cmd-bottom-collapse-bar"'), 'HTML contains bottom collapse bar with small arrow');
assert(indexHtml.includes('id="educator-command-center-backdrop"'), 'HTML contains educator-command-center-backdrop');
assert(indexHtml.includes('id="command-center-greeting"'), 'HTML contains command-center-greeting');
assert(indexHtml.includes('id="command-center-date-pill"'), 'HTML contains command-center-date-pill');
assert(indexHtml.includes('id="command-center-kpi-grid"'), 'HTML contains command-center-kpi-grid');
assert(indexHtml.includes('id="command-center-today-sessions-deck"'), 'HTML contains command-center-today-sessions-deck');
assert(indexHtml.includes('id="modal-pedagogical-ai-tools"'), 'HTML contains modal-pedagogical-ai-tools');
assert(indexHtml.includes('id="btn-pedagogical-tool-quiz"'), 'HTML contains btn-pedagogical-tool-quiz');
assert(indexHtml.includes('id="btn-pedagogical-tool-level"'), 'HTML contains btn-pedagogical-tool-level');
assert(indexHtml.includes('id="btn-pedagogical-tool-analogy"'), 'HTML contains btn-pedagogical-tool-analogy');
assert(indexHtml.includes('id="btn-pedagogical-tool-parent"'), 'HTML contains btn-pedagogical-tool-parent');
assert(indexHtml.includes('id="modal-print-lesson-plan"'), 'HTML contains modal-print-lesson-plan');
assert(indexHtml.includes('id="printable-lesson-plan-preview"'), 'HTML contains printable-lesson-plan-preview');

// 2. Function Existence
assert(typeof sandbox.renderCommandCenter === 'function', 'renderCommandCenter is a function');
assert(typeof sandbox.renderCommandCenterKPIs === 'function', 'renderCommandCenterKPIs is a function');
assert(typeof sandbox.renderCommandCenterTodaySessions === 'function', 'renderCommandCenterTodaySessions is a function');
assert(typeof sandbox.toggleCommandCenterCollapse === 'function', 'toggleCommandCenterCollapse is a function');
assert(typeof sandbox.openCommandCenterDrawer === 'function', 'openCommandCenterDrawer is a function');
assert(typeof sandbox.closeCommandCenterDrawer === 'function', 'closeCommandCenterDrawer is a function');
assert(typeof sandbox.initCommandCenterGestures === 'function', 'initCommandCenterGestures is a function');
assert(typeof sandbox.openPedagogicalAiModal === 'function', 'openPedagogicalAiModal is a function');
assert(typeof sandbox.closePedagogicalAiModal === 'function', 'closePedagogicalAiModal is a function');
assert(typeof sandbox.switchPedagogicalToolMode === 'function', 'switchPedagogicalToolMode is a function');
assert(typeof sandbox.executePedagogicalAiTool === 'function', 'executePedagogicalAiTool is a function');
assert(typeof sandbox.copyPedagogicalOutput === 'function', 'copyPedagogicalOutput is a function');
assert(typeof sandbox.openPrintLessonPlanModal === 'function', 'openPrintLessonPlanModal is a function');
assert(typeof sandbox.closePrintLessonPlanModal === 'function', 'closePrintLessonPlanModal is a function');
assert(typeof sandbox.handlePrintCourseSelectChange === 'function', 'handlePrintCourseSelectChange is a function');
assert(typeof sandbox.handlePrintLessonSelectChange === 'function', 'handlePrintLessonSelectChange is a function');
assert(typeof sandbox.renderPrintableLessonPlan === 'function', 'renderPrintableLessonPlan is a function');
assert(typeof sandbox.printLessonPlan === 'function', 'printLessonPlan is a function');
assert(typeof sandbox.copyPrintableLessonPlanText === 'function', 'copyPrintableLessonPlanText is a function');

// 3. Command Center KPI Calculation
const g25Today = new Date();
const g25TodayYMD = sandbox.formatDateToYMD(g25Today);
sandbox.APP_STATE.students = [
  { id: 'st_1', name: 'John Doe', status: 'active', schedule: [{ id: 's1', dateStr: g25TodayYMD, time: '4:00 PM', topic: 'Algebra' }] },
  { id: 'st_2', name: 'Jane Smith', status: 'paused', schedule: [] },
  { id: 'st_3', name: 'Bob Hope', status: 'completed', schedule: [] },
  { id: 'st_4', name: 'Alice Cooper', status: 'active', schedule: [{ id: 's2', dateStr: g25TodayYMD, time: '5:00 PM', topic: 'Geometry', status: 'completed' }] }
];
sandbox.APP_STATE.customCourses = [
  { id: 'course_math_1', title_en: 'Algebra I', lessons: [] },
  { id: 'course_math_2', title_en: 'Geometry', lessons: [] }
];
sandbox.renderCommandCenterKPIs();
const g25GridHtml = getOrCreateElem('command-center-kpi-grid').innerHTML;
assert(g25GridHtml.includes('id="cmd-kpi-students-count">2</div>'), 'KPI displays 2 active students (ignoring paused and completed)');
assert(g25GridHtml.includes('id="cmd-kpi-courses-count">2</div>'), 'KPI displays 2 custom courses');
assert(g25GridHtml.includes('id="cmd-kpi-today-sessions">2</div>'), 'KPI displays 2 sessions for today');
assert(g25GridHtml.includes('id="cmd-kpi-completed-month">1</div>'), 'KPI displays 1 completed session for current month');

// 4. Command Center Today Sessions Deck
sandbox.renderCommandCenterTodaySessions();
const g25DeckHtml = getOrCreateElem('command-center-today-sessions-deck').innerHTML;
assert(g25DeckHtml.includes('John Doe'), 'Today deck renders student John Doe');
assert(g25DeckHtml.includes('Alice Cooper'), 'Today deck renders student Alice Cooper');
assert(g25DeckHtml.includes('Algebra'), 'Today deck renders session topic Algebra');
assert(g25DeckHtml.includes('openTutorTeleprompterForSession'), 'Today deck provides 1-tap Teach trigger');

// 5. Command Center Collapsible Behavior & Drawer Controls
sandbox.APP_STATE.commandCenterCollapsed = false;
sandbox.toggleCommandCenterCollapse();
assert(sandbox.APP_STATE.commandCenterCollapsed === true, 'toggleCommandCenterCollapse sets collapsed to true');
const g25CmdBody = getOrCreateElem('command-center-body');
assert(g25CmdBody.classList.contains('hidden'), 'command-center-body is hidden when collapsed');
sandbox.toggleCommandCenterCollapse();
assert(sandbox.APP_STATE.commandCenterCollapsed === false, 'toggleCommandCenterCollapse sets collapsed to false');
assert(!g25CmdBody.classList.contains('hidden'), 'command-center-body is visible when expanded');

// Direct Drawer Controls
sandbox.closeCommandCenterDrawer();
assert(sandbox.APP_STATE.commandCenterCollapsed === true, 'closeCommandCenterDrawer sets collapsed to true');
assert(g25CmdBody.classList.contains('hidden'), 'closeCommandCenterDrawer hides body');
sandbox.openCommandCenterDrawer();
assert(sandbox.APP_STATE.commandCenterCollapsed === false, 'openCommandCenterDrawer sets collapsed to false');
assert(!g25CmdBody.classList.contains('hidden'), 'openCommandCenterDrawer reveals body');
sandbox.closeCommandCenterDrawer();

// 6. Pedagogical AI Tools
sandbox.openPedagogicalAiModal('quiz', 'Quadratic Equations');
const g25PedModal = getOrCreateElem('modal-pedagogical-ai-tools');
assert(!g25PedModal.classList.contains('hidden'), 'openPedagogicalAiModal unhides modal');
const g25TopicInput = getOrCreateElem('pedagogical-topic-input');
assert(g25TopicInput.value === 'Quadratic Equations', 'openPedagogicalAiModal sets topic input');

sandbox.switchPedagogicalToolMode('level');
sandbox.switchPedagogicalToolMode('analogy');
sandbox.switchPedagogicalToolMode('parent');

const fallbackQuiz = sandbox.generateFallbackPedagogicalContent('quiz', 'Newton Laws', 'High School', 'Emma');
assert(fallbackQuiz.includes('Diagnostic Practice Quiz'), 'Fallback quiz generates diagnostic questions');

const fallbackLevel = sandbox.generateFallbackPedagogicalContent('level', 'Cell Division', 'Elementary', 'Emma');
assert(fallbackLevel.includes('Differentiated Explanation'), 'Fallback level differentiates explanation');

const fallbackAnalogy = sandbox.generateFallbackPedagogicalContent('analogy', 'Ohm Law', 'Middle School', 'Emma');
assert(fallbackAnalogy.includes('Everyday Analogies'), 'Fallback analogy provides teaching hooks');

const fallbackParent = sandbox.generateFallbackPedagogicalContent('parent', 'Fractions', 'Elementary', 'Emma');
assert(fallbackParent.includes('Parent Progress Update for Emma'), 'Fallback parent crafts parent report');

// 7. Printable Lesson Plan & PDF Export
const g25SampleCourse = {
  id: 'course_chem_101',
  title_en: 'AP Chemistry',
  category: 'Sciences',
  target_level: 'High School',
  lessons: [
    {
      id: 'less_chem_1',
      title: 'Chemical Equilibrium & Le Chatelier Principle',
      sources_text: 'N2(g) + 3H2(g) <=> 2NH3(g) (Haber Process)',
      steps_text: '1. Introduce dynamic equilibrium\n2. Shift under pressure changes\n3. Worked equilibrium constant calculation',
      pitfalls_text: 'Catalysts speed up reaction rates but do NOT alter equilibrium position.',
      cheat_sheet_text: 'Keq = [Products]^coefficients / [Reactants]^coefficients',
      homework_text: 'Problems 1-10 on page 142.'
    }
  ]
};
sandbox.APP_STATE.customCourses.push(g25SampleCourse);
sandbox.openPrintLessonPlanModal('course_chem_101', 'less_chem_1');
const g25PrintModal = getOrCreateElem('modal-print-lesson-plan');
assert(!g25PrintModal.classList.contains('hidden'), 'openPrintLessonPlanModal unhides modal-print-lesson-plan');

sandbox.renderPrintableLessonPlan('course_chem_101', 'less_chem_1');
const g25PrintPreview = getOrCreateElem('printable-lesson-plan-preview').innerHTML;
assert(g25PrintPreview.includes('AP Chemistry'), 'Printable sheet includes Course Title');
assert(g25PrintPreview.includes('Chemical Equilibrium'), 'Printable sheet includes Lesson Title');
assert(g25PrintPreview.includes('Haber Process'), 'Printable sheet includes primary source');
assert(g25PrintPreview.includes('Introduce dynamic equilibrium'), 'Printable sheet includes key steps');
assert(g25PrintPreview.includes('Catalysts speed up reaction rates'), 'Printable sheet includes pitfalls');
assert(g25PrintPreview.includes('TutorPilot Educator Plan'), 'Printable sheet includes header branding');

// ==============================================
// Gate 26: Cross-Account Realtime Isolation & Deletion Synchronization Bug Fix
// ==============================================
console.log('\n--- Gate 26: Cross-Account Realtime Isolation & Deletion Sync ---');

// 1. External Account Realtime Isolation:
// Set current user as external tutor with isolated school
sandbox.APP_STATE.currentUser = {
  id: 'usr_ext_999',
  email: 'external_tutor@academy.org',
  role: 'tutor',
  school_id: 'school_ext_999'
};
sandbox.APP_STATE.customCourses = [
  { id: 'course_ext_1', title_en: 'External Biology', school_id: 'school_ext_999', lessons: [] }
];

// Verify targetCoursesId for external user is scoped
const g26SchoolId = sandbox.getActiveSchoolId();
assert(g26SchoolId === 'school_ext_999', 'External user has school_ext_999 active school ID');

// 2. Deletion Synchronization in mergeCustomCoursesWithCloud:
// Device A deleted course_ext_1, so cloudCourses now only has course_ext_2
const nowIso = new Date().toISOString();
const cloudCoursesUpdate = [
  { id: 'course_ext_2', title_en: 'External Chemistry', school_id: 'school_ext_999', updated_at: nowIso, lessons: [] }
];

// Call mergeCustomCoursesWithCloud with the newer cloud snapshot
sandbox.mergeCustomCoursesWithCloud(cloudCoursesUpdate, nowIso);

// Verify course_ext_1 was deleted and course_ext_2 was added
const g26CourseIds = sandbox.APP_STATE.customCourses.map(c => c.id);
assert(!g26CourseIds.includes('course_ext_1'), 'mergeCustomCoursesWithCloud removed deleted course_ext_1');
assert(g26CourseIds.includes('course_ext_2'), 'mergeCustomCoursesWithCloud added course_ext_2');

// 3. Lesson Deletion Synchronization:
// Course has 2 lessons locally
const courseWithLessons = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_ext_2');
courseWithLessons.lessons = [
  { id: 'les_1', title_en: 'Lesson 1' },
  { id: 'les_2', title_en: 'Lesson 2' }
];
const localUpdateIso = new Date(Date.now() + 1000).toISOString();
courseWithLessons.updated_at = localUpdateIso;

// Cloud update has les_2 deleted (only les_1 remains) with newer timestamp
const cloudUpdateIso = new Date(Date.now() + 2000).toISOString();
const cloudUpdatedCourse = {
  id: 'course_ext_2',
  title_en: 'External Chemistry',
  school_id: 'school_ext_999',
  updated_at: cloudUpdateIso,
  lessons: [{ id: 'les_1', title_en: 'Lesson 1' }]
};

sandbox.mergeCustomCoursesWithCloud([cloudUpdatedCourse], cloudUpdateIso);
const updatedCourse = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_ext_2');
assert(updatedCourse && updatedCourse.lessons.length === 1, 'mergeCustomCoursesWithCloud synced lesson deletion (only 1 lesson remains)');
assert(updatedCourse && updatedCourse.lessons[0].id === 'les_1', 'Retained lesson is les_1');

// 4. Cross-Tenant Sanity Filter on Storage Load:
// If an external user's storage was somehow contaminated with super_admin courses
sandbox.APP_STATE.customCourses.push({
  id: 'course_leaked_super',
  title_en: 'Super Admin Secret Course',
  school_id: 'school_main_770',
  created_by: 'shmueldoviduhlman@gmail.com',
  lessons: []
});
// Save to local storage mock
const extStorageKey = sandbox.getCustomCoursesStorageKey();
sandbox.localStorage.setItem(extStorageKey, JSON.stringify(sandbox.APP_STATE.customCourses));

// Load from storage as external user
sandbox.loadCustomCoursesFromStorage();
const sanitizedCourseIds = sandbox.APP_STATE.customCourses.map(c => c.id);
assert(!sanitizedCourseIds.includes('course_leaked_super'), 'loadCustomCoursesFromStorage purges cross-tenant master courses');

// 5. handleDeleteCustomCourseById resets insideCourseId and activeCourseId
sandbox.APP_STATE.insideCourseId = 'course_ext_2';
sandbox.APP_STATE.activeCourseId = 'course_ext_2';
sandbox.handleDeleteCustomCourseById('course_ext_2');
assert(sandbox.APP_STATE.insideCourseId === null, 'handleDeleteCustomCourseById cleanly resets insideCourseId');
assert(sandbox.APP_STATE.customCourses.length === 0, 'Course was removed from customCourses array');

// 6. Function existence
assert(typeof sandbox.handleDeleteCustomCourseById === 'function', 'handleDeleteCustomCourseById is a function');
assert(typeof sandbox.handleDeleteCustomLesson === 'function', 'handleDeleteCustomLesson is a function');
assert(typeof sandbox.handleDeleteActiveCustomCourse === 'function', 'handleDeleteActiveCustomCourse is a function');

// Gate 27: Next-Generation Two-Pane Course & Class Studio
(async () => {
  console.log('\n--- Gate 27: Next-Generation Two-Pane Course & Class Studio ---');

  // 1. HTML DOM Elements & Modals
  assert(indexHtml.includes('id="modal-studio-batch-outline"'), 'HTML contains modal-studio-batch-outline');
  assert(indexHtml.includes('id="modal-studio-ai-copilot"'), 'HTML contains modal-studio-ai-copilot');
  assert(indexHtml.includes('id="active-course-display-stats"'), 'HTML contains active-course-display-stats');
  assert(indexHtml.includes('openStudioBatchOutlineModal()'), 'Inside course header contains Batch Outline trigger');
  assert(indexHtml.includes('openStudioAiCoPilotModal()'), 'Inside course header contains AI Co-Pilot trigger');

  // 2. Core Studio Functions Existence
  assert(typeof sandbox.renderCourseClassesView === 'function', 'renderCourseClassesView is a function');
  assert(typeof sandbox.renderCourseStudio === 'function', 'renderCourseStudio is a function');
  assert(typeof sandbox.selectStudioClass === 'function', 'selectStudioClass is a function');
  assert(typeof sandbox.setStudioMobileView === 'function', 'setStudioMobileView is a function');
  assert(typeof sandbox.handleStudioQuickAddClass === 'function', 'handleStudioQuickAddClass is a function');
  assert(typeof sandbox.openStudioBatchOutlineModal === 'function', 'openStudioBatchOutlineModal is a function');
  assert(typeof sandbox.closeStudioBatchOutlineModal === 'function', 'closeStudioBatchOutlineModal is a function');
  assert(typeof sandbox.handleStudioBatchOutlineSubmit === 'function', 'handleStudioBatchOutlineSubmit is a function');
  assert(typeof sandbox.handleStudioMoveClass === 'function', 'handleStudioMoveClass is a function');
  assert(typeof sandbox.handleStudioDuplicateClass === 'function', 'handleStudioDuplicateClass is a function');
  assert(typeof sandbox.handleStudioDeleteClass === 'function', 'handleStudioDeleteClass is a function');
  assert(typeof sandbox.handleStudioClassTitleChange === 'function', 'handleStudioClassTitleChange is a function');
  assert(typeof sandbox.handleStudioUpdateClassField === 'function', 'handleStudioUpdateClassField is a function');
  assert(typeof sandbox.openStudioAiCoPilotModal === 'function', 'openStudioAiCoPilotModal is a function');
  assert(typeof sandbox.closeStudioAiCoPilotModal === 'function', 'closeStudioAiCoPilotModal is a function');
  assert(typeof sandbox.switchStudioAiCoPilotMode === 'function', 'switchStudioAiCoPilotMode is a function');
  assert(typeof sandbox.executeStudioAiSyllabusSuggest === 'function', 'executeStudioAiSyllabusSuggest is a function');
  assert(typeof sandbox.applyAllSuggestedClassesToCourse === 'function', 'applyAllSuggestedClassesToCourse is a function');
  assert(typeof sandbox.executeStudioAiGenerateFullClass === 'function', 'executeStudioAiGenerateFullClass is a function');
  assert(typeof sandbox.handleStudioMiniBlockAi === 'function', 'handleStudioMiniBlockAi is a function');

  // 3. Studio Clean Canvas & Empty State
  const testStudioCourse = {
    id: 'course_studio_test_1',
    title_en: 'AP Physics Mechanics',
    category: 'Physics',
    target_level: 'High School',
    lessons: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  sandbox.APP_STATE.customCourses = [testStudioCourse];
  sandbox.renderCourseClassesView('course_studio_test_1');
  assert(sandbox.APP_STATE.insideCourseId === 'course_studio_test_1', 'renderCourseClassesView sets insideCourseId');

  const studioEmptyHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(studioEmptyHtml.includes('course-studio-empty-state'), 'Empty course renders Studio Onboarding Canvas');
  assert(studioEmptyHtml.includes('input-studio-quick-class'), 'Empty course canvas provides rapid-fire quick-add input');
  assert(studioEmptyHtml.includes('openStudioBatchOutlineModal'), 'Empty course canvas provides Batch Outline trigger');
  assert(studioEmptyHtml.includes('openStudioAiCoPilotModal'), 'Empty course canvas provides AI Co-Pilot trigger');

  // 4. Rapid-Fire 1-Line Class Creator
  getOrCreateElem('input-studio-quick-class').value = '1. Kinematics & Velocity';
  sandbox.handleStudioQuickAddClass(null, 'course_studio_test_1');
  assert(testStudioCourse.lessons.length === 1, 'Quick-Add successfully created first class');
  assert(testStudioCourse.lessons[0].title_en === '1. Kinematics & Velocity', 'First class has correct title');
  assert(testStudioCourse.lessons[0].lesson_num === 1, 'First class lesson_num is 1');
  assert(sandbox.APP_STATE.studioSelectedLessonId === testStudioCourse.lessons[0].id, 'Newly added class is selected in Studio');

  // Quick-Add second class
  getOrCreateElem('input-studio-quick-class').value = 'Acceleration in 1D';
  sandbox.handleStudioQuickAddClass(null, 'course_studio_test_1');
  assert(testStudioCourse.lessons.length === 2, 'Quick-Add successfully created second class');
  assert(testStudioCourse.lessons[1].lesson_num === 2, 'Second class lesson_num is 2');

  // 5. Screen 2 Clean Lesson List + Screen 4 Live 5/7 Studio Rendering Verification
  const listScreenHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(listScreenHtml.includes('1. Kinematics &amp; Velocity') || listScreenHtml.includes('1. Kinematics & Velocity'), 'Screen 2 Lesson List renders quick-added lesson names');
  sandbox.enterStudioEditLessonMode('course_studio_test_1', testStudioCourse.lessons[0].id);
  const studioActiveHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(studioActiveHtml.includes('studio-class-ai-partner') && studioActiveHtml.includes('lg:col-span-5'), 'Screen 4 Edit Studio renders Left Pane (5/12 AI Co-Builder & Sources)');
  assert(studioActiveHtml.includes('studio-modular-blocks-container') && studioActiveHtml.includes('lg:col-span-7'), 'Screen 4 Edit Studio renders Right Pane (7/12 Lesson Sections)');
  assert(studioActiveHtml.includes('studio-class-title-input'), 'Active class renders in-place editable title input');
  assert(studioActiveHtml.includes('studio-save-indicator'), 'Active class renders live auto-save indicator');
  assert(studioActiveHtml.includes('Opening Hook / Real-World Analogy'), 'Active class renders Opening Hook modular block');
  assert(studioActiveHtml.includes('Core Knowledge Anchors'), 'Active class renders Core Anchors modular block');
  assert(studioActiveHtml.includes('Primary Sources, Quotes & Formulas'), 'Active class renders Primary Sources modular block');
  assert(studioActiveHtml.includes('Step-by-Step Procedure & Flow'), 'Active class renders Step-by-Step modular block');
  assert(studioActiveHtml.includes('Common Pitfalls & Misconceptions'), 'Active class renders Common Pitfalls modular block');
  assert(studioActiveHtml.includes('Teacher Secret Cheat Sheet'), 'Active class renders Secret Cheat Sheet modular block');
  assert(studioActiveHtml.includes('Student Homework Challenge'), 'Active class renders Homework Challenge modular block');
  assert(studioActiveHtml.includes('Audio & Voice Recordings'), 'Active class renders Audio Studio modular block');

  // 6. In-Place Field Updates & Auto-Save
  const selectedLesson = testStudioCourse.lessons[1];
  sandbox.handleStudioClassTitleChange('course_studio_test_1', selectedLesson.id, 'Kinematics: 1D Acceleration');
  assert(selectedLesson.title_en === 'Kinematics: 1D Acceleration', 'In-place title change updated lesson title');

  sandbox.handleStudioUpdateClassField('course_studio_test_1', selectedLesson.id, 'hook_en', 'Imagine pressing the gas pedal: what actually changes?');
  assert(selectedLesson.hook_en.includes('gas pedal'), 'handleStudioUpdateClassField updated hook_en');

  sandbox.handleStudioUpdateClassField('course_studio_test_1', selectedLesson.id, 'anchors_en', 'Instantaneous Velocity\nAverage Acceleration\nConstant vs Variable');
  assert(Array.isArray(selectedLesson.anchors_en) && selectedLesson.anchors_en.length === 3, 'handleStudioUpdateClassField parsed multiline anchors');

  sandbox.handleStudioUpdateClassField('course_studio_test_1', selectedLesson.id, 'sources_text', 'v = v0 + at');
  assert(selectedLesson.sources_text === 'v = v0 + at', 'handleStudioUpdateClassField updated sources_text');

  sandbox.handleStudioUpdateClassField('course_studio_test_1', selectedLesson.id, 'duration', '60m');
  assert(selectedLesson.duration === '60m', 'handleStudioUpdateClassField updated duration');

  // 7. Class Reordering
  sandbox.handleStudioMoveClass('course_studio_test_1', selectedLesson.id, -1);
  assert(testStudioCourse.lessons[0].id === selectedLesson.id, 'handleStudioMoveClass moved second lesson up to index 0');
  assert(testStudioCourse.lessons[0].lesson_num === 1, 'Reordered lesson re-indexed lesson_num to 1');
  assert(testStudioCourse.lessons[1].lesson_num === 2, 'Pushed lesson re-indexed lesson_num to 2');

  // 8. Class Duplication
  const countBeforeDup = testStudioCourse.lessons.length;
  sandbox.handleStudioDuplicateClass('course_studio_test_1', selectedLesson.id);
  assert(testStudioCourse.lessons.length === countBeforeDup + 1, 'handleStudioDuplicateClass incremented lessons count');
  assert(testStudioCourse.lessons[1].title_en.includes('Copy of Kinematics: 1D Acceleration'), 'Duplicated lesson has Copy of prefix');
  assert(testStudioCourse.lessons[1].sources_text === 'v = v0 + at', 'Duplicated lesson cloned sources_text');
  assert(testStudioCourse.lessons[1].lesson_num === 2, 'Duplicated lesson has proper lesson_num');

  // 9. Batch Outline Importer
  getOrCreateElem('input-studio-batch-outline').value = '1. Projectile Motion\n2. Circular Motion and Centripetal Force\n- Gravitational Fields and Orbits';
  getOrCreateElem('chk-studio-batch-clean').checked = true;

  const countBeforeBatch = testStudioCourse.lessons.length;
  sandbox.handleStudioBatchOutlineSubmit('course_studio_test_1');
  assert(testStudioCourse.lessons.length === countBeforeBatch + 3, 'Batch outline imported 3 new classes');
  assert(testStudioCourse.lessons[countBeforeBatch].title_en === 'Projectile Motion', 'Batch outline stripped leading digit 1.');
  assert(testStudioCourse.lessons[countBeforeBatch + 1].title_en === 'Circular Motion and Centripetal Force', 'Batch outline stripped leading digit 2.');
  assert(testStudioCourse.lessons[countBeforeBatch + 2].title_en === 'Gravitational Fields and Orbits', 'Batch outline stripped bullet hyphen');

  // 10. Studio AI Co-Pilot
  sandbox.openStudioAiCoPilotModal('course_studio_test_1', testStudioCourse.lessons[0].id);
  assert(!getOrCreateElem('modal-studio-ai-copilot').classList.contains('hidden'), 'openStudioAiCoPilotModal unhides copilot modal');

  sandbox.switchStudioAiCoPilotMode('syllabus');
  assert(!getOrCreateElem('panel-studio-copilot-syllabus').classList.contains('hidden'), 'switchStudioAiCoPilotMode reveals syllabus panel');

  sandbox.switchStudioAiCoPilotMode('class');
  assert(!getOrCreateElem('panel-studio-copilot-class').classList.contains('hidden'), 'switchStudioAiCoPilotMode reveals class panel');

  await sandbox.executeStudioAiGenerateFullClass();
  assert(sandbox.getStudioCopilotContext().generatedContent !== null, 'executeStudioAiGenerateFullClass produced content');
  sandbox.applyGeneratedContentToActiveClass();
  assert(testStudioCourse.lessons[0].hook_en.length > 0, 'applyGeneratedContentToActiveClass populated active class hook');
  assert(testStudioCourse.lessons[0].steps_text.length > 0, 'applyGeneratedContentToActiveClass populated active class steps');

  // 11. Mobile View Mode Toggling
  sandbox.setStudioMobileView('editor');
  assert(sandbox.APP_STATE.studioMobileView === 'editor', 'setStudioMobileView sets studioMobileView to editor');
  sandbox.setStudioMobileView('syllabus');
  assert(sandbox.APP_STATE.studioMobileView === 'syllabus', 'setStudioMobileView sets studioMobileView to syllabus');

  // ==============================================
  // Gate 28: Universal Domain-Neutral Course Creator, Strict Profile Isolation & Deletion Parity
  // ==============================================
  console.log('\n--- Gate 28: Universal Course Creator & Profile Isolation ---');

  // 1. Zero Hardcoded Parshiot in Classes Setup Dropdown
  assert(!indexHtml.includes('54_parshiot'), 'Dropdown does NOT contain 54_parshiot preset');
  assert(!indexHtml.includes('All 54 Torah Parshiot'), 'Dropdown does NOT contain Torah parshiot preset text');
  assert(!indexHtml.includes('getTorahParshiot54Lessons'), 'getTorahParshiot54Lessons function permanently excised');
  assert(indexHtml.includes('Start with Empty Syllabus'), 'Dropdown contains Start with Empty Syllabus');
  assert(indexHtml.includes('<option value="4">4 Lessons</option>'), 'Dropdown contains 4 Lessons option');

  // 2. Profile Stamping on Course Creation
  sandbox.APP_STATE.currentUser = {
    id: 'usr_super_1',
    email: 'shmueldoviduhlman@gmail.com',
    role: 'super_admin',
    school_id: 'school_main_770'
  };
  getOrCreateElem('input-quick-course-title-blank').value = 'Calculus AB';
  sandbox.handleQuickCreateCourseSubmit();
  const createdCalcCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Calculus AB');
  assert(createdCalcCourse !== undefined, 'Quick-create created universal Calculus course');
  assert(createdCalcCourse.created_by === 'shmueldoviduhlman@gmail.com', 'Course stamped with creator email');
  assert(createdCalcCourse.owner_id === 'usr_super_1', 'Course stamped with creator user id');
  assert(createdCalcCourse.category === 'General Curriculum', 'Course category defaults to General Curriculum');
  assert(createdCalcCourse.lessons.length === 1, 'Quick-create produces single introductory lesson');
  assert(createdCalcCourse.lessons[0].title_en.includes('Calculus AB'), 'Lesson title references Calculus AB');

  // 3. Strict Profile Isolation
  // Switch active user to an external user account
  sandbox.APP_STATE.currentUser = {
    id: 'usr_ext_dr_smith',
    email: 'dr_smith@highschool.org',
    role: 'tutor',
    school_id: 'school_ext_smith'
  };
  // Save current storage with Calc course
  sandbox.saveCustomCoursesToStorage(false);
  // Switch storage key to Dr. Smith's key and load
  sandbox.APP_STATE.customCourses = [createdCalcCourse];
  sandbox.loadCustomCoursesFromStorage();
  const smithCourses = sandbox.APP_STATE.customCourses.map(c => c.title_en);
  assert(!smithCourses.includes('Calculus AB'), 'External user cannot see super admin courses');

  // Dr. Smith creates their own course
  getOrCreateElem('input-quick-course-title-blank').value = 'AP European History';
  sandbox.handleQuickCreateCourseSubmit();
  const smithHistoryCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'AP European History');
  assert(smithHistoryCourse !== undefined, 'Dr. Smith created AP European History');
  assert(smithHistoryCourse.created_by === 'dr_smith@highschool.org', 'Dr. Smith course stamped with their email');

  // Switch back to super admin: super admin should NOT see Dr. Smith's course
  sandbox.APP_STATE.currentUser = {
    id: 'usr_super_1',
    email: 'shmueldoviduhlman@gmail.com',
    role: 'super_admin',
    school_id: 'school_main_770'
  };
  sandbox.APP_STATE.customCourses = [smithHistoryCourse];
  sandbox.loadCustomCoursesFromStorage();
  const superAdminCourses = sandbox.APP_STATE.customCourses.map(c => c.title_en);
  assert(!superAdminCourses.includes('AP European History'), 'Super admin cannot see external user courses');

  // 4. Studio Class Deletion & Studio Re-render
  sandbox.APP_STATE.customCourses = [createdCalcCourse];
  const testCourse = createdCalcCourse;
  // Add a second class
  testCourse.lessons.push({
    id: 'lesson_calc_2',
    lesson_num: 2,
    title_en: 'Derivatives and Limits',
    duration: '45m',
    status: 'draft'
  });
  sandbox.APP_STATE.insideCourseId = testCourse.id;
  sandbox.APP_STATE.studioSelectedLessonId = 'lesson_calc_2';

  // Delete the second class via handleStudioDeleteClass
  sandbox.handleStudioDeleteClass(testCourse.id, 'lesson_calc_2');
  assert(testCourse.lessons.length === 1, 'Class was deleted from course');
  assert(!testCourse.lessons.some(l => l.id === 'lesson_calc_2'), 'Deleted lesson ID is removed from course lessons');
  assert(testCourse.deleted_lesson_ids.includes('lesson_calc_2'), 'Deleted lesson ID tracked in deleted_lesson_ids');
  assert(sandbox.APP_STATE.studioSelectedLessonId === testCourse.lessons[0].id, 'studioSelectedLessonId advanced to remaining lesson');

  // 5. Authoritative Two-Way Course Deletion Sync with Clock Skew Tolerance
  // Delete the course
  sandbox.handleDeleteCustomCourseById(testCourse.id);
  assert(!sandbox.APP_STATE.customCourses.some(c => c.id === testCourse.id), 'Course deleted locally');
  assert(sandbox.APP_STATE.insideCourseId === null, 'insideCourseId reset after course deletion');

  // Verify that an incoming stale cloud snapshot with old course is rejected because of tombstone
  const staleCloudUpdate = [
    {
      id: testCourse.id,
      title_en: 'Calculus AB',
      created_by: 'shmueldoviduhlman@gmail.com',
      updated_at: new Date(Date.now() - 10000).toISOString(),
      lessons: []
    }
  ];
  sandbox.mergeCustomCoursesWithCloud(staleCloudUpdate, new Date(Date.now() - 10000).toISOString());
  assert(!sandbox.APP_STATE.customCourses.some(c => c.id === testCourse.id), 'Deleted course is NOT resurrected by stale cloud snapshot');

  // 6. Super Admin Exclusivity & Classroom Owner Badge Distinctness
  // Test Super Admin display
  const superAdminSession = {
    email: 'shmueldoviduhlman@gmail.com',
    role: 'super_admin',
    name_en: 'Shmuel Dovid Uhlman'
  };
  sandbox.APP_STATE.currentUser = superAdminSession;
  sandbox.updateUserSessionDisplay(superAdminSession);
  const superBadgeHtml = getOrCreateElem('user-dropdown-role-badge').innerHTML;
  assert(superBadgeHtml.includes('Super Admin'), 'shmueldoviduhlman@gmail.com displays Super Admin badge');
  assert(sandbox.isSuperAdminUser() === true, 'shmueldoviduhlman@gmail.com is identified as super admin user');

  // Test secondary account shmueluhlman@gmail.com (david)
  const davidSession = {
    email: 'shmueluhlman@gmail.com',
    role: 'classroom_owner',
    school_id: 'school_shmueluhlman_gmail_com',
    name_en: 'david',
    school_name: "david's Classroom"
  };
  sandbox.APP_STATE.currentUser = davidSession;
  sandbox.updateUserSessionDisplay(davidSession);
  const davidBadgeHtml = getOrCreateElem('user-dropdown-role-badge').innerHTML;
  assert(!davidBadgeHtml.includes('Super Admin'), 'shmueluhlman@gmail.com does NOT display Super Admin badge');
  assert(davidBadgeHtml.includes('Classroom Owner') || davidBadgeHtml.includes('Tutor'), 'shmueluhlman@gmail.com displays Classroom Owner or Tutor badge');
  assert(sandbox.isSuperAdminUser() === false, 'shmueluhlman@gmail.com is NOT super admin user');

  // 7. Strict Account Isolation: Super Admin does NOT inherit secondary account courses
  sandbox.APP_STATE.currentUser = superAdminSession;
  sandbox.APP_STATE.customCourses = [];
  sandbox.localStorage.setItem('tutor_custom_courses', '[]');
  sandbox.localStorage.setItem('tutor_custom_courses_shmueluhlman_gmail_com', JSON.stringify([
    {
      id: 'course_shabbat_1',
      title_en: 'Shabbat: Meaning, Stories, and Inspiration',
      created_by: 'shmueluhlman@gmail.com',
      lessons: []
    }
  ]));
  sandbox.loadCustomCoursesFromStorage();
  const loadedTitles = sandbox.APP_STATE.customCourses.map(c => c.title_en);
  assert(!loadedTitles.includes('Shabbat: Meaning, Stories, and Inspiration'), 'Strict account isolation: Super Admin does NOT inherit secondary account courses');

  // ==============================================
  // GATE 29: END-TO-END MULTI-TENANT ISOLATION & TWO-WAY DELETION PARITY
  // ==============================================
  console.log('\n--- Gate 29: End-to-End Multi-Tenant Isolation & Two-Way Deletion Parity ---');

  // 1. Secondary user workspace isolation
  sandbox.APP_STATE.currentUser = davidSession;
  assert(sandbox.isMasterAccount() === false, 'Secondary user is NOT master account');
  assert(sandbox.getActiveSchoolId() === 'school_shmueluhlman_gmail_com', 'Secondary user active school is strictly independent');

  // 2. Secondary user creates a course
  const secondaryCourse = {
    id: 'course_independent_101',
    title_en: 'Independent Creative Writing',
    title_he: 'כתיבה יוצרת עצמאית',
    created_by: 'shmueluhlman@gmail.com',
    owner_id: 'david_id',
    school_id: 'school_shmueluhlman_gmail_com',
    lessons: [
      { id: 'les_indep_1', lesson_num: 1, title_en: 'Finding Your Voice', title_he: 'מציאת הקול שלך' },
      { id: 'les_indep_2', lesson_num: 2, title_en: 'Plot Architecture', title_he: 'מבנה עלילה' }
    ]
  };
  sandbox.APP_STATE.customCourses = [secondaryCourse];
  sandbox.saveCustomCoursesToStorage(false);

  // 3. Switch back to Super Admin - verify secondary course is 100% invisible
  sandbox.APP_STATE.currentUser = superAdminSession;
  sandbox.loadCustomCoursesFromStorage();
  const superAdminVisibleCourseIds = sandbox.APP_STATE.customCourses.map(c => c.id);
  assert(!superAdminVisibleCourseIds.includes('course_independent_101'), 'Super Admin CANNOT see courses created by secondary account');

  // 4. Switch back to Secondary User - verify course is visible to owner
  sandbox.APP_STATE.currentUser = davidSession;
  sandbox.loadCustomCoursesFromStorage();
  const davidVisibleCourseIds = sandbox.APP_STATE.customCourses.map(c => c.id);
  assert(davidVisibleCourseIds.includes('course_independent_101'), 'Course is visible to its creator');

  // 5. Two-way lesson deletion: Secondary user deletes a lesson
  assert(typeof sandbox.handleDeleteCustomLesson === 'function', 'handleDeleteCustomLesson is a function');
  sandbox.handleDeleteCustomLesson('course_independent_101', 'les_indep_1', true);
  const remainingLessons = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_independent_101').lessons;
  assert(remainingLessons.length === 1, 'Lesson was deleted from course');
  assert(remainingLessons[0].id === 'les_indep_2', 'Correct lesson remains in course');

  // 6. Two-way cross-device cloud deletion parity (simulated cloud sync from phone)
  const phoneUpdatedCourses = [
    {
      id: 'course_independent_101',
      title_en: 'Independent Creative Writing',
      title_he: 'כתיבה יוצרת עצמאית',
      created_by: 'shmueluhlman@gmail.com',
      owner_id: 'david_id',
      school_id: 'school_shmueluhlman_gmail_com',
      updated_at: new Date(Date.now() + 10000).toISOString(),
      lessons: [] // Phone deleted the last remaining lesson
    }
  ];
  sandbox.mergeCustomCoursesWithCloud(phoneUpdatedCourses);
  const syncedLessons = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_independent_101').lessons;
  assert(syncedLessons.length === 0, 'Class deleted on phone is cleanly deleted on computer');

  // 7. Student roster isolation: External user cannot see Super Admin students
  sandbox.APP_STATE.currentUser = davidSession;
  const testRoster = [
    { id: 'stu_super_1', name: 'Super Student', owner_email: 'shmueldoviduhlman@gmail.com', school_id: 'school_main_770' },
    { id: 'stu_david_1', name: 'David Student', owner_email: 'shmueluhlman@gmail.com', school_id: 'school_shmueluhlman_gmail_com' }
  ];
  sandbox.localStorage.setItem(sandbox.getStudentStorageKey(), JSON.stringify(testRoster));
  sandbox.loadStudentsFromStorage();
  const visibleStudentIds = sandbox.APP_STATE.students.map(s => s.id);
  assert(!visibleStudentIds.includes('stu_super_1'), 'External user cannot see Super Admin students');
  assert(visibleStudentIds.includes('stu_david_1'), 'External user can see their own students');

  // ==============================================
  // GATE 30: CONVERSATIONAL AI COURSE ARCHITECT & DYNAMIC BLUEPRINT STUDIO
  // ==============================================
  console.log('\n--- Gate 30: Conversational AI Course Architect & Dynamic Blueprint Studio ---');

  // 1. Universal Block Catalog & Architect Functions
  assert(typeof sandbox.COURSE_BLOCK_CATALOG === 'object', 'COURSE_BLOCK_CATALOG is defined');
  assert(Object.keys(sandbox.COURSE_BLOCK_CATALOG).length >= 10, 'COURSE_BLOCK_CATALOG provides 10+ versatile block types');
  assert(typeof sandbox.applyArchitectBlueprintUpdate === 'function', 'applyArchitectBlueprintUpdate is a function');
  assert(typeof sandbox.handleQuickAddArchitectSection === 'function', 'handleQuickAddArchitectSection is a function');
  assert(typeof sandbox.moveBlueprintSection === 'function', 'moveBlueprintSection is a function');
  assert(typeof sandbox.handleStudioMiniBlockCustomAi === 'function', 'handleStudioMiniBlockCustomAi is a function');

  // 2. Conversational AI Architect designs a custom course structure first
  sandbox.APP_STATE.currentUser = superAdminSession;
  sandbox.openCreateCourseModal('ai');
  getOrCreateElem('input-create-course-title-en').value = 'Guitar & Songwriting Lab';
  getOrCreateElem('input-ai-blueprint-prompt').value = 'Build a music course with scales, chord drills, repertoire, and audio recordings';
  await sandbox.handleAiSuggestBlueprint();

  const chatHtml = getOrCreateElem('architect-chat-messages').innerHTML;
  assert(chatHtml.includes('AI Course Architect'), 'Architect chat renders conversational AI reply');
  assert(chatHtml.includes('Music') || chatHtml.includes('Warmup'), 'Architect chat reflects music course discussion');
  assert(sandbox.currentBlueprintSections.length >= 4, 'Live blueprint updated with custom music sections');

  // 3. Manual side edit: add and reorder a section + set guidelines
  getOrCreateElem('architect-add-block-type').value = 'discussion';
  getOrCreateElem('architect-add-block-name').value = 'Ear Training Q&A';
  sandbox.handleQuickAddArchitectSection();
  assert(sandbox.currentBlueprintSections.some(s => s.name === 'Ear Training Q&A'), 'Manual side edit added custom section');
  getOrCreateElem('input-architect-student-profile').value = 'Teen beginner guitarists';
  sandbox.updateArchitectMetadataField('student_profile', 'Teen beginner guitarists');
  getOrCreateElem('input-architect-guidelines').value = '5-min prep, hands-on practice';
  sandbox.updateArchitectMetadataField('guidelines', '5-min prep, hands-on practice');

  // 4. Save course & verify Dynamic Studio renders ONLY custom blueprint sections (NOT hardcoded generic blocks)
  getOrCreateElem('ai-builder-lessons-count-unified').value = 'blueprint';
  await sandbox.handleGenerateFullCourseFromAi();
  const musicCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Guitar & Songwriting Lab');
  assert(!!musicCourse, 'Music course created from AI Architect');
  assert(musicCourse.blueprint.student_profile === 'Teen beginner guitarists', 'Course saved target student profile');
  assert(musicCourse.blueprint.guidelines === '5-min prep, hands-on practice', 'Course saved teaching guidelines');

  getOrCreateElem('input-studio-quick-class').value = 'Class 1: Open Chords & Strumming';
  sandbox.handleStudioQuickAddClass(null, musicCourse.id);
  sandbox.enterStudioEditLessonMode(musicCourse.id, musicCourse.lessons[0].id);
  const studioMusicHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(studioMusicHtml.includes('Warmup &amp; Scales') || studioMusicHtml.includes('Warmup & Scales'), 'Dynamic Studio renders custom Music section Warmup & Scales');
  assert(studioMusicHtml.includes('Ear Training Q&amp;A') || studioMusicHtml.includes('Ear Training Q&A'), 'Dynamic Studio renders manually added custom section');
  assert(!studioMusicHtml.includes('Teacher Secret Cheat Sheet'), 'Dynamic Studio does NOT force hardcoded Teacher Secret Cheat Sheet onto custom Music course');

  // 5. Architecture-Aware AI Class Generation populates custom section IDs
  sandbox.openStudioAiCoPilotModal(musicCourse.id, musicCourse.lessons[0].id);
  await sandbox.executeStudioAiGenerateFullClass();
  sandbox.applyGeneratedContentToActiveClass();
  const firstMusicSecId = musicCourse.blueprint.sections[0].id;
  assert(Boolean(musicCourse.lessons[0].sections[firstMusicSecId]), 'Architecture-aware AI populated custom section ID directly');

  // 6. Reopen Architect for existing course to continue refining without losing classes
  sandbox.openEditCustomCourseModal(musicCourse.id);
  assert(getOrCreateElem('input-architect-student-profile').value === 'Teen beginner guitarists', 'Reopening Architect preserves existing student profile');
  assert(musicCourse.lessons.length === 1, 'Existing classes preserved when reopening Course Architect');

  // ==============================================
  // GATE 31: SPECIALIZED 11-SECTION BLOCK ENGINE & TELEPROMPTER PARITY
  // ==============================================
  console.log('\n--- Gate 31: Specialized 11-Section Block Engine & Teleprompter Parity ---');

  assert(typeof sandbox.parseStructuredSectionData === 'function', 'parseStructuredSectionData is a function');
  assert(typeof sandbox.formatSectionInlineText === 'function', 'formatSectionInlineText is a function');
  assert(typeof sandbox.renderCustomBlueprintSectionCard === 'function', 'renderCustomBlueprintSectionCard is a function');
  assert(typeof sandbox.assignSectionTaskToStudent === 'function', 'assignSectionTaskToStudent is a function');

  const formattedBold = sandbox.formatSectionInlineText('**Key Idea**: Always check `x > 0`');
  assert(formattedBold.includes('<strong') && formattedBold.includes('<code'), 'formatSectionInlineText formats bold & inline code cleanly');

  const all11Course = {
    id: 'course_all_11_test',
    title_en: 'All 11 Blocks Lab',
    blueprint: {
      version: '2.0',
      student_profile: 'Test Students',
      guidelines: 'Structured specialized blocks',
      sections: [
        { id: 'sec_1_text', type: 'text', name: 'Overview' },
        { id: 'sec_2_list', type: 'list', name: 'Core Bullets' },
        { id: 'sec_3_steps', type: 'steps', name: 'Step Timeline' },
        { id: 'sec_4_quote', type: 'quote', name: 'Hebrew Verse' },
        { id: 'sec_5_ex', type: 'example', name: 'Worked Story' },
        { id: 'sec_6_drill', type: 'exercise', name: 'Practice Drills' },
        { id: 'sec_7_pit', type: 'pitfalls', name: 'Common Traps' },
        { id: 'sec_8_disc', type: 'discussion', name: 'Debate Prompt' },
        { id: 'sec_9_refl', type: 'reflection', name: 'Life Challenge' },
        { id: 'sec_10_hw', type: 'homework', name: 'Weekly Homework' },
        { id: 'sec_11_aud', type: 'audio', name: 'Audio Lab' }
      ]
    },
    lessons: [
      {
        id: 'les_11_1',
        lesson_num: 1,
        title_en: 'Lesson With All 11 Blocks',
        recordings: [{ id: 'rec_sec11', title: 'Track 1', url: 'https://example.com/a.mp3', sectionId: 'sec_11_aud' }],
        sections: {}
      }
    ]
  };

  sandbox.APP_STATE.customCourses = [all11Course];
  sandbox.APP_STATE.students = [
    { id: 'stu_assign_test', name: 'Levi Student', skills: { customGoals: [], homework: { task: '', completed: false } } }
  ];
  sandbox.APP_STATE.activeStudentId = 'stu_assign_test';

  // AI Draft all 11 sections via Copilot
  sandbox.openStudioAiCoPilotModal(all11Course.id, 'les_11_1');
  await sandbox.executeStudioAiGenerateFullClass();
  sandbox.applyGeneratedContentToActiveClass();

  sandbox.enterStudioEditLessonMode(all11Course.id, 'les_11_1');
  const all11Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(all11Html.includes('אבג RTL'), 'Quote block provides RTL toggle control');
  assert(all11Html.includes('Punchline / Key Lesson / Solution'), 'Example block provides collapsible takeaway field');
  assert(all11Html.includes('+ Add Practice Drill'), 'Exercise block renders Q&A drill repeater');
  assert(all11Html.includes('+ Add Trap &amp; Fix') || all11Html.includes('+ Add Trap & Fix'), 'Pitfalls block renders Trap & Fix repeater');
  assert(all11Html.includes('Follow-up cue'), 'Discussion block renders follow-up cue field');
  assert(all11Html.includes('+ Send to Student Goal'), 'Reflection block provides direct student goal assignment');
  assert(all11Html.includes('Assign to Student'), 'Homework block provides direct student homework assignment');
  assert(all11Html.includes('Track 1'), 'Audio block renders scoped section recording');

  // Interactive mutations: Quote RTL toggle, Drill Add, Homework Assign
  sandbox.toggleSectionQuoteRtl(all11Course.id, 'les_11_1', 'sec_4_quote');
  const parsedQuote = sandbox.parseStructuredSectionData(all11Course.lessons[0].sections['sec_4_quote'], 'quote');
  assert(parsedQuote.rtl === true, 'toggleSectionQuoteRtl flipped rtl state');

  sandbox.handleSectionRepeaterAdd(all11Course.id, 'les_11_1', 'sec_6_drill', 'exercise');
  const parsedExercise = sandbox.parseStructuredSectionData(all11Course.lessons[0].sections['sec_6_drill'], 'exercise');
  assert(parsedExercise.items.length === 3, 'handleSectionRepeaterAdd added new Q&A drill');

  sandbox.assignSectionTaskToStudent(all11Course.id, 'les_11_1', 'sec_10_hw', 'homework');
  assert(sandbox.APP_STATE.students[0].skills.homework.task.includes('Lesson With All 11 Blocks'), 'assignSectionTaskToStudent pushed homework directly to student');

  sandbox.assignSectionTaskToStudent(all11Course.id, 'les_11_1', 'sec_9_refl', 'reflection');
  assert(sandbox.APP_STATE.students[0].skills.customGoals.length === 1, 'assignSectionTaskToStudent added life goal directly to student');

  // Teleprompter rendering of all 11 specialized sections including embedded <audio>
  sandbox.openTutorTeleprompter(all11Course.id, 'les_11_1');
  const tpHtml = getOrCreateElem('teleprompter-content-container').innerHTML;
  assert(tpHtml.includes('Step 1'), 'Teleprompter renders Step badges');
  assert(tpHtml.includes('Reveal Key Lesson / Solution'), 'Teleprompter renders Example reveal button');
  assert(tpHtml.includes('Watch Out For') && tpHtml.includes('Quick Fix'), 'Teleprompter renders Pitfalls Trap & Fix alert cards');
  assert(tpHtml.includes('<audio controls'), 'Teleprompter embeds playable <audio> controls directly inside Audio sections');
  sandbox.closeTutorTeleprompter();

  // ==============================================
  // GATE 32: 20-SECTION UNIVERSAL ARCHITECT CATALOG, THEMES & INTERACTIVE AI
  // ==============================================
  console.log('\n--- Gate 32: 20-Section Universal Architect Catalog, Themes & Interactive AI ---');

  assert(Object.keys(sandbox.COURSE_BLOCK_CATALOG).length >= 20, 'COURSE_BLOCK_CATALOG supports 20+ specialized block types');
  assert(indexHtml.includes('value="bilingual_split"') && indexHtml.includes('value="quiz"') && indexHtml.includes('value="flashcards"'), 'HTML dropdown includes new interactive section options');
  assert(indexHtml.includes('id="input-course-theme-style"') && indexHtml.includes('id="input-course-density"'), 'HTML includes expanded Theme Style and Density selectors');
  assert(indexHtml.includes('data-color="teal"') && indexHtml.includes('data-color="orange"') && indexHtml.includes('data-color="slate"'), 'HTML includes 10 expanded course color swatches');

  // Auto default rules + per-section customization overrides
  sandbox.openCreateCourseModal('ai');
  getOrCreateElem('input-create-course-title-en').value = 'Universal All-20 Studio Lab';
  sandbox.addBlueprintSection('bilingual_split', 'Source & Translation');
  sandbox.addBlueprintSection('table', 'Rules Comparison');
  sandbox.addBlueprintSection('quiz', 'Quick Check');
  sandbox.addBlueprintSection('flashcards', 'Key Terms');
  sandbox.addBlueprintSection('timed_activity', 'Speed Drill');
  sandbox.addBlueprintSection('dialogue', 'Roleplay');
  sandbox.addBlueprintSection('image', 'Diagram');
  sandbox.addBlueprintSection('video_links', 'Video Clips');
  sandbox.addBlueprintSection('teacher_cue', 'Prep Cue');

  assert(sandbox.currentBlueprintSections.length === 9, 'Added all 9 new section types');
  assert(Boolean(sandbox.currentBlueprintSections[0].ai_rule), 'addBlueprintSection automatically sets default AI rule');
  assert(sandbox.currentBlueprintSections[0].rtl_default === true, 'bilingual_split defaults rtl_default to true');
  assert(sandbox.currentBlueprintSections[8].teacher_only === true, 'teacher_cue defaults teacher_only to true');

  const tableSecId = sandbox.currentBlueprintSections[1].id;
  sandbox.updateBlueprintSectionProp(tableSecId, 'color', 'emerald');
  assert(sandbox.currentBlueprintSections[1].color === 'emerald', 'Per-section color override saved cleanly');

  getOrCreateElem('input-course-theme-style').value = 'classic_framed';
  getOrCreateElem('input-course-density').value = 'compact';
  sandbox.selectCourseColor('indigo');
  getOrCreateElem('ai-builder-lessons-count-unified').value = 'blueprint';
  await sandbox.handleGenerateFullCourseFromAi();

  const labCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Universal All-20 Studio Lab');
  assert(!!labCourse, 'Universal All-20 Studio Lab created');
  assert(labCourse.blueprint.theme_style === 'classic_framed', 'Course saved classic_framed theme style');
  assert(labCourse.blueprint.density === 'compact', 'Course saved compact density');
  assert(labCourse.color === 'indigo', 'Course saved indigo color theme');

  getOrCreateElem('input-studio-quick-class').value = 'Session 1: Full Interactive Demo';
  sandbox.handleStudioQuickAddClass(null, labCourse.id);
  const labLessonId = labCourse.lessons[0].id;

  // Architecture-Aware AI drafts all 9 new structured block types
  sandbox.openStudioAiCoPilotModal(labCourse.id, labLessonId);
  await sandbox.executeStudioAiGenerateFullClass();
  sandbox.applyGeneratedContentToActiveClass();

  sandbox.enterStudioEditLessonMode(labCourse.id, labLessonId);
  const labHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(labHtml.includes('border-2'), 'Classic Framed theme style applied to section cards');
  assert(labHtml.includes('+ Add Row') && labHtml.includes('+ Column'), 'Table editor renders row & column controls');
  assert(labHtml.includes('+ Add Question'), 'Quiz editor renders question repeater');
  assert(labHtml.includes('+ Add Flashcard'), 'Flashcards editor renders front/back repeater');
  assert(labHtml.includes('Upload Image'), 'Image block provides local image upload');
  assert(labHtml.includes('+ Add Video / Link'), 'Video & Resource Links editor renders link repeater');
  assert(labHtml.includes('Teacher Only'), 'Teacher Cue section displays Teacher Only badge');

  // Interactive mutations: table row add + flashcard add
  sandbox.handleSectionTableAddRow(labCourse.id, labLessonId, tableSecId);
  const parsedTable = sandbox.parseStructuredSectionData(labCourse.lessons[0].sections[tableSecId], 'table');
  assert(parsedTable.rows.length === 3, 'handleSectionTableAddRow added new comparison row');

  // Teleprompter interactivity across new blocks
  sandbox.openTutorTeleprompter(labCourse.id, labLessonId);
  const tpLabHtml = getOrCreateElem('teleprompter-content-container').innerHTML;
  assert(tpLabHtml.includes('Click card to flip') && tpLabHtml.includes('flipFlashcardElement'), 'Teleprompter renders clickable flip flashcards');
  assert(tpLabHtml.includes('selectQuizChoice'), 'Teleprompter renders interactive multiple-choice quiz');
  assert(tpLabHtml.includes('startSectionCountdown'), 'Teleprompter renders interactive timed activity countdown controls');
  assert(tpLabHtml.includes('<table'), 'Teleprompter renders comparison matrix table');
  assert(tpLabHtml.includes('(Teacher Only)'), 'Teleprompter highlights Private Teacher Cue box');
  sandbox.closeTutorTeleprompter();

  // --- GATE 33: Canonical callGeminiApi, Multi-Model Fallback & Intelligent Multi-Turn Architect ---
  console.log('\n--- Running Gate 33: callGeminiApi & Multi-Turn AI Course Architect Verification ---');
  assert(typeof sandbox.callGeminiApi === 'function', 'callGeminiApi global function is defined');

  const prevFetch = sandbox.fetch;
  const geminiRequests = [];
  sandbox.fetch = async (url, opts) => {
    const bodyObj = opts && opts.body ? JSON.parse(opts.body) : {};
    geminiRequests.push({ url, body: bodyObj });
    if (url.includes('gemini-3.5-flash:')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } })
      };
    }
    const lastTurnText = bodyObj.contents && bodyObj.contents.length
      ? bodyObj.contents[bodyObj.contents.length - 1].parts.map(p => p.text).join(' ')
      : '';
    if (lastTurnText.includes('Between 12 to 13')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  assistant_reply: 'Thanks! Knowing he is 12 to 13 from a non-religious background helps keep our opening dilemma super relatable. How many minutes is each session?',
                  course_title_en: 'Key Jewish Concepts Explained',
                  student_profile: '12-13 year old boy, non-religious background',
                  guidelines: 'Relatable everyday stories, zero unexplained jargon',
                  sections: [
                    { type: 'text', name: 'Relatable Opening Hook', ai_rule: 'Modern teen dilemma before Hebrew terms' },
                    { type: 'list', name: 'Connected Core Ideas', ai_rule: '4 connected ideas step by step' },
                    { type: 'discussion', name: 'Open Teen Debate', ai_rule: 'One real-world question to spark discussion' }
                  ]
                })
              }]
            }
          }]
        })
      };
    }
    if (lastTurnText.includes('Key Jewish concepts')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  assistant_reply: 'Love this direction! For a non-religious boy, starting from everyday relatable curiosity works best. Are there specific concepts you want first, and how long is each class?',
                  course_title_en: 'Key Jewish Concepts Explained',
                  student_profile: 'Boy from a non-religious background',
                  guidelines: 'Plain English, vivid modern analogies, interactive',
                  sections: [
                    { type: 'text', name: 'Relatable Opening Hook', ai_rule: 'Modern teen dilemma before Hebrew terms' },
                    { type: 'list', name: 'Connected Core Ideas', ai_rule: '4 connected ideas step by step' },
                    { type: 'discussion', name: 'Open Teen Debate', ai_rule: 'One real-world question to spark discussion' }
                  ]
                })
              }]
            }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'AI drafted custom block content via managed key' }]
          }
        }]
      })
    };
  };

  // Clear local custom key to verify built-in SYSTEM_DEFAULT_GEMINI_KEY via getEffectiveGeminiApiKey()
  sandbox.APP_STATE.geminiApiKey = '';
  sandbox.APP_STATE.geminiModel = '';
  sandbox.localStorage.removeItem('gemini_api_key');
  sandbox.localStorage.removeItem('tutor_gemini_key');
  sandbox.localStorage.removeItem('tutor_gemini_model');

  const directReply = await sandbox.callGeminiApi('Ping test');
  assert(directReply === 'AI drafted custom block content via managed key', 'callGeminiApi skips 503 model and returns response using built-in managed key');
  assert(sandbox.APP_STATE.geminiModel === 'gemini-3-flash-preview', 'callGeminiApi routes standard requests through flagship gemini-3-flash-preview model');

  // Test Multi-turn Architect conversation
  geminiRequests.length = 0;
  sandbox.openCreateCourseModal('ai');
  getOrCreateElem('input-ai-blueprint-prompt').value = 'Key Jewish concepts in an interesting way for a boy from a non-religious background';
  await sandbox.handleAiSuggestBlueprint();
  assert(geminiRequests.length >= 1, 'Architect Turn 1 called Gemini API via callGeminiApi');
  const turn1Contents = geminiRequests[geminiRequests.length - 1].body.contents || [];
  assert(turn1Contents.length === 1 && turn1Contents[0].role === 'user', 'Architect Turn 1 strips initial greeting so Gemini contents begins cleanly with user turn');
  assert(!sandbox.architectChatHistory[sandbox.architectChatHistory.length - 1].text.includes('Reading & Fluency'), 'Architect Turn 1 did NOT trigger false Reading & Fluency template');

  // Turn 2 clarifying reply
  getOrCreateElem('input-ai-blueprint-prompt').value = 'Between 12 to 13';
  await sandbox.handleAiSuggestBlueprint();
  const turn2Body = geminiRequests[geminiRequests.length - 1].body;
  assert(turn2Body.contents.length === 3 && turn2Body.contents[1].role === 'model' && turn2Body.contents[2].role === 'user', 'Architect Turn 2 forwards full alternating multi-turn conversation history to Gemini');
  const lastArchReply = sandbox.architectChatHistory[sandbox.architectChatHistory.length - 1].text;
  assert(lastArchReply.includes('12 to 13') && !lastArchReply.includes('What specific sections do you want inside every class'), 'Architect Turn 2 remembers student age and does not reset to canned prompt');
  assert(getOrCreateElem('input-architect-student-profile').value.includes('12-13'), 'Architect Turn 2 updates student profile in blueprint');

  // Test offline incremental preservation fallback (when fetch rejects)
  sandbox.fetch = async () => { throw new Error('Network offline'); };
  getOrCreateElem('input-ai-blueprint-prompt').value = 'For age 14-15';
  const prevSectionsCount = sandbox.currentBlueprintSections.length;
  await sandbox.handleAiSuggestBlueprint();
  assert(sandbox.currentBlueprintSections.length === prevSectionsCount, 'Offline fallback preserves existing blueprint sections on clarifying reply instead of wiping them');
  assert(sandbox.architectChatHistory[sandbox.architectChatHistory.length - 1].text.includes('14-15'), 'Offline fallback merges clarifying age into conversation response cleanly');

  // Restore fetch for Custom Block AI check with mock response
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify('Smart Gemini block content') }] } }]
    })
  });
  await sandbox.handleStudioMiniBlockCustomAi(labCourse.id, labLessonId, tableSecId);
  const refreshedCourse = sandbox.APP_STATE.customCourses.find(c => c.id === labCourse.id);
  const secVal = refreshedCourse.lessons[0].sections[tableSecId];
  assert(String(secVal).length > 0, 'handleStudioMiniBlockCustomAi invokes callGeminiApi with built-in key cleanly');

  sandbox.fetch = prevFetch;

  // --- GATE 34: Clean 4/8 Class Studio, Inline Syllabus Planner & Embedded Conversational AI Co-Builder ---
  console.log('\n--- Running Gate 34: Clean Class Studio & Embedded AI Class Partner ---');
  assert(!indexHtml.includes('<span>+ Add Class</span>') && !indexHtml.includes('<span>+ Add Course</span>') && !indexHtml.includes('<span>+ Course</span>'), 'Header buttons avoid double ++ plus icon clutter');
  assert(indexHtml.includes('id="inside-course-header-card"') && indexHtml.includes('overflow-hidden'), 'Course header prevents horizontal button clipping');

  const studioCourse34 = {
    id: 'course_clean_studio_34',
    title_en: 'Jewish Foundations: Teen Relevance',
    title_he: 'יסודות היהדות',
    target_level: 'Middle School (Ages 12-14)',
    color: 'amber',
    icon: '✦',
    blueprint: {
      version: '2.0',
      student_profile: '12-13 year old boy from a non-religious background',
      guidelines: 'Start with relatable teen dilemma, zero unexplained jargon',
      sections: [
        { id: 'sec34_hook', type: 'example', name: 'The Modern Hook', ai_rule: 'Relatable teen dilemma setup & takeaway' },
        { id: 'sec34_pit', type: 'pitfalls', name: 'Misconceptions & Clarifications', ai_rule: 'Address common teen questions cleanly' }
      ]
    },
    lessons: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  sandbox.APP_STATE.customCourses.push(studioCourse34);
  sandbox.renderCourseStudio(studioCourse34.id);

  const emptyStudio34Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(emptyStudio34Html.includes('executeStudioInlineSyllabusAi'), 'Empty Class Studio showcases AI Plan Syllabus directly');

  const gate34FetchCalls = [];
  const prevFetch34 = sandbox.fetch;
  sandbox.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    gate34FetchCalls.push({ url, body });
    const sysText = body.systemInstruction?.parts?.[0]?.text || '';
    const lastUser = body.contents?.length ? body.contents[body.contents.length - 1].parts.map(p => p.text).join(' ') : '';

    if (lastUser.includes('sequential next class') || lastUser.includes('Plan a syllabus') || lastUser.includes('Jewish Foundations')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(['Unplugging: Why Shabbat Beats Airplane Mode', 'Food With Intention: Beyond Diet Rules', 'Time Anchors: How Holidays Shape Identity']) }] } }]
        })
      };
    }

    if (lastUser.includes('Misconceptions') || lastUser.includes('Pitfalls')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  assistant_reply: 'Sharpened only the Misconceptions section to directly answer teen pushback while keeping your Modern Hook unchanged.',
                  updated_title: null,
                  sections: {
                    sec34_pit: { items: [{ trap: 'Shabbat feels like a list of boring no-no rules.', fix: 'Reframe Shabbat as a protected 25-hour upgrade for family, sleep, and real freedom.' }] }
                  }
                })
              }]
            }
          }]
        })
      };
    }

    if (sysText.includes('Master Lesson Co-Builder')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  assistant_reply: 'Drafted both your Modern Hook and Misconceptions sections tailored for a 12-13 year old teen!',
                  updated_title: null,
                  sections: {
                    sec34_hook: { setup: 'Imagine your phone is locked in a drawer for 25 hours with zero notifications.', takeaway: 'That calm space is exactly what Shabbat builds every week.' },
                    sec34_pit: { items: [{ trap: 'Thinking Shabbat means doing nothing.', fix: 'Show how it is filled with games, food, and real conversations.' }] }
                  }
                })
              }]
            }
          }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
  };

  await sandbox.executeStudioInlineSyllabusAi(studioCourse34.id, 'Plan a syllabus for teen relevance');
  assert(sandbox.studioInlineSyllabusSuggestions.length === 3, 'Inline AI Syllabus Planner parsed 3 class titles cleanly');
  sandbox.addAllInlineSuggestedClasses(studioCourse34.id);
  assert(studioCourse34.lessons.length === 3, 'addAllInlineSuggestedClasses populated course syllabus with all 3 classes');

  const firstClass34 = studioCourse34.lessons[0];
  sandbox.enterStudioEditLessonMode(studioCourse34.id, firstClass34.id);
  const studio34Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(studio34Html.includes('lg:col-span-5') && studio34Html.includes('lg:col-span-7'), 'Studio upgraded to full-width 5/7 live split layout on desktop');
  assert(studio34Html.includes('studio-blueprint-summary-bar') && studio34Html.includes('View Rules'), 'Blueprint banner uses sleek collapsible single-line summary bar');
  assert(studio34Html.includes('studio-class-ai-partner') && !studio34Html.includes('id="studio-class-ai-partner" class="hidden '), 'Embedded AI Class Partner opens automatically on fresh empty classes');

  // Auto-Draft whole class via Embedded AI Class Partner
  await sandbox.triggerStudioQuickAutoDraftClass(studioCourse34.id, firstClass34.id, 'draft');
  const draftedHook = sandbox.parseStructuredSectionData(firstClass34.sections.sec34_hook, 'example');
  assert(draftedHook.setup.includes('25 hours'), 'triggerStudioQuickAutoDraftClass drafted custom Modern Hook block cleanly');

  // Turn 2 Selective Refinement: ask AI Partner to update only Pitfalls without wiping Hook!
  getOrCreateElem('input-studio-class-ai-prompt').value = 'Sharpen the Misconceptions / Pitfalls section for pushback';
  await sandbox.sendStudioClassAiMessage(studioCourse34.id, firstClass34.id);
  const stillIntactHook = sandbox.parseStructuredSectionData(firstClass34.sections.sec34_hook, 'example');
  const updatedPit = sandbox.parseStructuredSectionData(firstClass34.sections.sec34_pit, 'pitfalls');
  assert(stillIntactHook.setup.includes('25 hours'), 'Multi-turn AI Partner preserves untouched Hook block when refining Pitfalls');
  assert(updatedPit.items[0].trap.includes('boring no-no rules'), 'Multi-turn AI Partner selectively updates targeted section cleanly');
  assert(firstClass34.ai_chat_history.length >= 5, 'Per-class multi-turn conversation history persists on lesson');

  const lastG34Body = gate34FetchCalls[gate34FetchCalls.length - 1].body;
  assert(lastG34Body.contents.length === 3 && lastG34Body.contents[0].role === 'user', 'sendStudioClassAiMessage sends alternating multi-turn history to Gemini');

  sandbox.fetch = prevFetch34;

  // --- GATE 35: Clean Two-Tab Lesson Workbench, Fluent Composer & Multimodal Source Analyzer (Links, Audio, Notes) ---
  console.log('\n--- Running Gate 35: Clean Two-Tab Lesson Studio & Multimodal Source Analysis ---');
  assert(typeof sandbox.setStudioWorkspaceTab === 'function', 'setStudioWorkspaceTab is a function');
  assert(typeof sandbox.addStudioLinkSource === 'function', 'addStudioLinkSource is a function');
  assert(typeof sandbox.addStudioPasteTextSource === 'function', 'addStudioPasteTextSource is a function');
  assert(typeof sandbox.analyzeStudioSourcesWithAi === 'function', 'analyzeStudioSourcesWithAi is a function');
  assert(typeof sandbox.removeStudioSource === 'function', 'removeStudioSource is a function');
  assert(indexHtml.includes('id="input-studio-class-ai-prompt"') && indexHtml.includes('<textarea'), 'Fluent multi-line composer uses expanding <textarea>');

  // Verify duplicate stacked course picker nav bar remains hidden in both Courses Directory and Class Studio
  sandbox.openCourseClassesView(studioCourse34.id);
  assert(getOrCreateElem('study-courses-nav-bar').classList.contains('hidden'), 'Top course picker bar hides inside Class Studio to prevent stacked bar clutter');
  sandbox.showAllCoursesView();
  assert(getOrCreateElem('study-courses-nav-bar').classList.contains('hidden'), 'Top course picker bar stays hidden in My Courses directory to avoid duplicate header clutter');

  // Verify clean mobile 2-tab switching + desktop live split inside Edit Lesson Studio
  const srcLesson35 = studioCourse34.lessons[1];
  sandbox.openCourseClassesView(studioCourse34.id);
  sandbox.enterStudioEditLessonMode(studioCourse34.id, srcLesson35.id);
  let g35Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(g35Html.includes('id="btn-studio-tab-ai"') && g35Html.includes('id="btn-studio-tab-sections"'), 'Studio renders clean mobile 2-tab switcher (AI & Sources vs Sections)');
  assert(g35Html.includes('id="studio-modular-blocks-container" class="hidden'), 'On mobile < lg screens, Sections panel yields cleanly to AI & Sources tab');

  sandbox.setStudioWorkspaceTab(srcLesson35.id, 'sections');
  g35Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(g35Html.includes('id="studio-class-ai-partner" class="hidden') && !g35Html.includes('id="studio-modular-blocks-container" class="hidden'), 'Switching to Sections tab focuses Sections panel on mobile while remaining 5/7 live on desktop');

  sandbox.setStudioWorkspaceTab(srcLesson35.id, 'ai');

  // Mock Link extraction + Multimodal Gemini call verifying inlineData audio + extracted link text
  const prevFetch35 = sandbox.fetch;
  const g35Payloads = [];
  sandbox.fetch = async (url, opts) => {
    if (url.includes('youtube.com/oembed')) {
      return { ok: true, status: 200, json: async () => ({ title: 'Why Keep Kosher? Teen Deep Dive', author_name: 'Jewish Insights' }) };
    }
    if (url.startsWith('https://r.jina.ai/')) {
      return { ok: true, status: 200, text: async () => 'Article summary: Mindful eating connects everyday life to values and discipline.' };
    }
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    g35Payloads.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                assistant_reply: 'I read your attached link (Mindful Eating) and listened to your voice memo! Here is a tailored plan: frame Kosher as intentional living.',
                sections: {}
              })
            }]
          }
        }]
      })
    };
  };

  getOrCreateElem('input-studio-source-url').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  getOrCreateElem('input-studio-source-note').value = 'Use his analogy at 2:10';
  await sandbox.addStudioLinkSource(studioCourse34.id, srcLesson35.id);
  assert(srcLesson35.ai_sources.length === 1 && srcLesson35.ai_sources[0].extractedText.includes('Mindful eating'), 'addStudioLinkSource extracted YouTube metadata & article text for AI analysis');

  getOrCreateElem('input-studio-source-paste-title').value = 'Torah Source Sheet';
  getOrCreateElem('input-studio-source-paste-text').value = 'Vayikra 11 commentary on spiritual mindfulness.';
  sandbox.addStudioPasteTextSource(studioCourse34.id, srcLesson35.id);
  assert(srcLesson35.ai_sources.length === 2, 'addStudioPasteTextSource attached pasted reference excerpt cleanly');

  // Simulate attached recorded voice note base64 audio inlineData
  srcLesson35.ai_sources.push({
    id: 'src_audio_35',
    kind: 'audio',
    label: 'Teacher Voice Memo',
    mimeType: 'audio/webm',
    dataUrl: 'data:audio/webm;base64,T2dnUwAC',
    base64Data: 'T2dnUwAC',
    status: 'ready'
  });

  await sandbox.analyzeStudioSourcesWithAi(studioCourse34.id, srcLesson35.id);
  const lastTurnParts = g35Payloads[g35Payloads.length - 1].contents.slice(-1)[0].parts;
  assert(lastTurnParts.some(p => p.text && p.text.includes('Mindful eating') && p.text.includes('Torah Source Sheet')), 'AI prompt receives extracted web link text & pasted notes');
  assert(lastTurnParts.some(p => p.inlineData && p.inlineData.mimeType === 'audio/webm' && p.inlineData.data === 'T2dnUwAC'), 'AI payload transmits audio voice note via native Gemini inlineData');
  assert(!srcLesson35.sections || Object.keys(srcLesson35.sections).length === 0, 'Analyze Sources First proposes insights without prematurely overwriting lesson sections');

  sandbox.removeStudioSource(studioCourse34.id, srcLesson35.id, 'src_audio_35');
  assert(srcLesson35.ai_sources.length === 2, 'removeStudioSource removes unwanted attachment cleanly');

  sandbox.fetch = prevFetch35;

  // --- GATE 36: Unified Full-Width No-Clipping Studio, RTL Auto-Grow, Per-Section AI Tweak & CORS Links ---
  console.log('\n--- Running Gate 36: Clean No-Clipping Unified Lesson Studio Refresh ---');
  assert(typeof sandbox.toggleStudioSyllabusRail === 'function', 'toggleStudioSyllabusRail is a function');
  assert(typeof sandbox.handleStudioSectionTargetedTweak === 'function', 'handleStudioSectionTargetedTweak is a function');
  assert(typeof sandbox.estimateTextareaRows === 'function', 'estimateTextareaRows is a function');
  assert(typeof sandbox.promoteStudioSourceToLessonAudio === 'function', 'promoteStudioSourceToLessonAudio is a function');

  const g36Course = studioCourse34;
  const g36Lesson = g36Course.lessons[0];
  sandbox.enterStudioEditLessonMode(g36Course.id, g36Lesson.id);
  let g36Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;

  assert(!g36Html.includes('Open in Modal Editor'), 'Unified Studio removes distracting Open in Modal Editor fallback link');
  assert(g36Html.includes('studio-autogrow') && g36Html.includes('dir="auto"'), 'Section fields use auto-growing dir="auto" textareas with zero horizontal sentence clipping');
  assert(sandbox.estimateTextareaRows('Line 1\nLine 2\nLine 3\n' + 'x'.repeat(210), 2, 12) >= 5, 'estimateTextareaRows scales height cleanly for multi-paragraph copy');

  // Verify back-to-lessons cleanly returns to Screen 2 List Mode
  sandbox.exitStudioToLessonList(g36Course.id);
  assert(getOrCreateElem('tutor-hub-lessons-container').innerHTML.includes('studio-lesson-list-screen'), 'exitStudioToLessonList returns cleanly to Screen 2 Lesson List');
  sandbox.enterStudioEditLessonMode(g36Course.id, g36Lesson.id);

  // Test CORS noembed link extraction + Source Preview + Teach Audio Promotion
  const prevFetch36 = sandbox.fetch;
  let calledNoembed = false;
  sandbox.fetch = async (url, opts) => {
    if (url.includes('noembed.com/embed')) {
      calledNoembed = true;
      return { ok: true, status: 200, json: async () => ({ title: 'Finding Freedom in Shabbat', author_name: 'Inspiration Lab' }) };
    }
    if (url.startsWith('https://r.jina.ai/')) {
      return { ok: true, status: 200, text: async () => 'Detailed transcript about Bill Gates disconnect dinner.' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                setup: 'Rewritten Bill Gates dinner hook grounded in your story!',
                takeaway: 'Disconnect to actually reconnect.'
              })
            }]
          }
        }]
      })
    };
  };

  getOrCreateElem('input-studio-source-url').value = 'https://www.youtube.com/watch?v=abc12345';
  await sandbox.addStudioLinkSource(g36Course.id, g36Lesson.id);
  assert(calledNoembed, 'addStudioLinkSource uses CORS-safe noembed.com endpoint for YouTube metadata');
  assert(g36Lesson.ai_sources.some(s => s.extractedText.includes('Bill Gates disconnect dinner')), 'addStudioLinkSource stores extracted article transcript for AI');

  // Toggle audio source promotion to Teach Class recordings
  g36Lesson.ai_sources.push({
    id: 'src_rec_36',
    kind: 'audio',
    label: 'Shiur Story Clip',
    mimeType: 'audio/webm',
    dataUrl: 'data:audio/webm;base64,QUJD',
    base64Data: 'QUJD',
    status: 'ready'
  });
  sandbox.promoteStudioSourceToLessonAudio(g36Course.id, g36Lesson.id, 'src_rec_36');
  assert(Array.isArray(g36Lesson.recordings) && g36Lesson.recordings.some(r => r.sourceRefId === 'src_rec_36'), 'promoteStudioSourceToLessonAudio saves prep voice note to Teach Class Audio');

  // Test Per-Section AI Tweak preserves sibling Pitfalls section while rewriting Hook
  const prevPitfalls36 = g36Lesson.sections.sec34_pit;
  await sandbox.handleStudioSectionTargetedTweak(g36Course.id, g36Lesson.id, 'sec34_hook', 'Use the Bill Gates story here');
  const updatedHook36 = sandbox.parseStructuredSectionData(g36Lesson.sections.sec34_hook, 'example');
  assert(updatedHook36.setup.includes('Bill Gates dinner hook'), 'handleStudioSectionTargetedTweak rewrote targeted section from attached source');
  assert(g36Lesson.sections.sec34_pit === prevPitfalls36, 'handleStudioSectionTargetedTweak preserves all sibling sections intact');

  // Verify openAiCreateClassModal opens Studio directly instead of popup modal
  getOrCreateElem('modal-add-custom-lesson').classList.add('hidden');
  sandbox.openAiCreateClassModal(g36Course.id);
  assert(getOrCreateElem('modal-add-custom-lesson').classList.contains('hidden'), 'openAiCreateClassModal routes straight into Unified Studio without opening old popup modal');

  sandbox.fetch = prevFetch36;

  // --- GATE 37: Total Classes & Lessons Makeover (My Courses -> Clean List -> Document Reader -> 5/7 Edit Studio + AI Undo) ---
  console.log('\n--- Running Gate 37: Total Classes & Lessons Makeover (4-Screen Flow + Reader + AI Undo) ---');
  assert(typeof sandbox.enterStudioEditLessonMode === 'function', 'enterStudioEditLessonMode is a function');
  assert(typeof sandbox.exitStudioToLessonList === 'function', 'exitStudioToLessonList is a function');
  assert(typeof sandbox.renderLessonCleanReader === 'function', 'renderLessonCleanReader is a function');
  assert(typeof sandbox.renderSectionReadOnlyHtml === 'function', 'renderSectionReadOnlyHtml is a function');
  assert(typeof sandbox.undoLastStudioAiChange === 'function', 'undoLastStudioAiChange is a function');

  const g37Course = {
    id: 'course_g37_makeover',
    title_en: 'Modern Jewish Philosophy',
    category: 'General Curriculum',
    target_level: 'High School (Ages 15-18)',
    blueprint: {
      version: '2.0',
      student_profile: 'Curious teen thinkers',
      guidelines: 'Socratic style, clean narrative',
      sections: [
        { id: 's37_hook', type: 'example', name: 'Modern Hook' },
        { id: 's37_cards', type: 'flashcards', name: 'Key Concepts' },
        { id: 's37_quiz', type: 'quiz', name: 'Quick Check' },
        { id: 's37_pit', type: 'pitfalls', name: 'Misconceptions' }
      ]
    },
    lessons: [
      {
        id: 'les_g37_1',
        lesson_num: 1,
        title_en: 'Time vs Space: The Architecture of Shabbat',
        duration: '45m',
        status: 'ready',
        recordings: [{ id: 'rec_g37_1', title: 'Intro Story Clip', url: 'https://example.com/intro.mp3' }],
        sections: {
          s37_hook: JSON.stringify({ setup: 'Why do we check notifications every 6 minutes?', takeaway: 'Shabbat creates a sanctuary in time rather than space.' }),
          s37_cards: JSON.stringify({ items: [{ front: 'Menuchah', back: 'Restorative peace & intentional cessation' }] }),
          s37_quiz: JSON.stringify({ items: [{ q: 'What does Heschel call Shabbat?', options: ['A palace in time', 'A museum'], correct: 0 }] }),
          s37_pit: JSON.stringify({ items: [{ trap: 'Shabbat is passive boredom', fix: 'Active celebration of presence and community' }] })
        }
      }
    ]
  };
  sandbox.APP_STATE.customCourses.push(g37Course);

  // Screen 1: My Courses shows clean single header, Add a New Course, clickable cards, and hides duplicate yellow bar
  sandbox.showAllCoursesView();
  assert(getOrCreateElem('study-courses-nav-bar').classList.contains('hidden'), 'Screen 1 My Courses hides duplicate top yellow bar');
  assert(indexHtml.includes('+ Add a New Course'), 'Screen 1 header features Add a New Course CTA');
  const cardsGridHtml = getOrCreateElem('courses-cards-grid').innerHTML;
  assert(cardsGridHtml.includes('openCourseClassesView(\'course_g37_makeover\')'), 'Course card is directly clickable to open its lessons');
  assert(getOrCreateElem('btn-purge-all-courses').classList.contains('hidden'), 'Screen 1 My Courses permanently hides Clear All courses button to prevent accidental bulk deletion');

  // Screen 2: Inside Course opens strictly clean Lesson Number + Name list
  sandbox.openCourseClassesView('course_g37_makeover');
  assert(!getOrCreateElem('inside-course-header-card').classList.contains('hidden'), 'Screen 2 Lesson List displays Inside Course header card');
  const screen2Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(screen2Html.includes('studio-lesson-list-screen'), 'Screen 2 renders dedicated clean Lesson List view');
  assert(screen2Html.includes('id="studio-rapid-add-box" class="hidden"'), 'Screen 2 hides redundant quick lesson input bar below lesson list');
  assert(screen2Html.includes('Time vs Space: The Architecture of Shabbat'), 'Screen 2 displays lesson title cleanly');
  assert(!screen2Html.includes('studio-class-ai-partner') && !screen2Html.includes('studio-lesson-reader') && !screen2Html.includes('studio-inline-syllabus-drawer'), 'Screen 2 omits raw editor forms, reader body, and stacked Topic focus syllabus clutter');

  // Screen 3: Clicking a lesson opens Full Clean Lesson Reader with zero raw input fields + Edit Lesson CTA
  sandbox.selectStudioClass('les_g37_1');
  assert(getOrCreateElem('inside-course-header-card').classList.contains('hidden'), 'Screen 3 Reader hides top Inside Course header so only one clean Reader bar is shown');
  const screen3Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(screen3Html.includes('studio-lesson-reader'), 'Screen 3 renders Clean Full Lesson Reader');
  assert(screen3Html.includes('Why do we check notifications every 6 minutes?'), 'Screen 3 renders formatted lesson story prose');
  assert(screen3Html.includes('flipReaderCard') && screen3Html.includes('selectReaderQuizOption') && screen3Html.includes('toggleReaderElement'), 'Screen 3 renders interactive flip flashcards, quiz options, and reveal toggles');
  assert(screen3Html.includes('Intro Story Clip') && screen3Html.includes('<audio controls'), 'Screen 3 renders playable HTML5 audio recordings');
  assert(!screen3Html.includes('<textarea'), 'Screen 3 Reader contains zero raw textarea inputs');
  assert(screen3Html.includes('id="btn-reader-edit-lesson"'), 'Screen 3 Reader exposes prominent Edit Lesson button');

  // Screen 4: Clicking Edit Lesson enters Unified 5/7 Split Studio pre-loaded with existing content
  sandbox.enterStudioEditLessonMode('course_g37_makeover', 'les_g37_1');
  assert(getOrCreateElem('inside-course-header-card').classList.contains('hidden'), 'Screen 4 Edit Studio hides extra course header for full workspace breathing room');
  let screen4Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(screen4Html.includes('studio-edit-topbar') && screen4Html.includes('btn-edit-done-view-lesson'), 'Screen 4 renders single unified Edit topbar with Done View Lesson action');
  assert(screen4Html.includes('lg:col-span-5') && screen4Html.includes('lg:col-span-7'), 'Screen 4 renders 5/7 desktop live split (AI Co-Builder + Lesson Sections)');
  assert(screen4Html.includes('Why do we check notifications every 6 minutes?'), 'Screen 4 Edit Studio pre-loads existing lesson sections in real time');

  // Clicking + New Lesson enters identical Screen 4 Edit Studio on fresh lesson
  sandbox.handleStudioAddNewClassQuick('course_g37_makeover');
  assert(g37Course.lessons.length === 2, 'handleStudioAddNewClassQuick created Lesson 2');
  assert(getOrCreateElem('tutor-hub-lessons-container').innerHTML.includes('studio-class-ai-partner'), 'New Lesson enters Screen 4 Build/Edit Studio directly');

  // Verify AI update pill + Undo AI Change snapshot restore on Lesson 1
  sandbox.enterStudioEditLessonMode('course_g37_makeover', 'les_g37_1');
  const prevFetch37 = sandbox.fetch;
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              assistant_reply: 'Rewrote your Modern Hook with a gaming console shutdown analogy.',
              sections: {
                s37_hook: { setup: 'Imagine your Wi-Fi router unplugs automatically every Friday evening.', takeaway: 'Reclaiming attention is real freedom.' }
              }
            })
          }]
        }
      }]
    })
  });

  getOrCreateElem('input-studio-class-ai-prompt').value = 'Rewrite the Modern Hook using a Wi-Fi analogy';
  await sandbox.sendStudioClassAiMessage('course_g37_makeover', 'les_g37_1');
  assert(sandbox.parseStructuredSectionData(g37Course.lessons[0].sections.s37_hook, 'example').setup.includes('Wi-Fi router'), 'AI Co-Builder live-updated targeted section inside Screen 4');
  screen4Html = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(screen4Html.includes('✓ Updated') && screen4Html.includes('id="btn-undo-studio-ai"'), 'Screen 4 displays Updated badge on AI-modified section and Undo AI Change button');

  sandbox.undoLastStudioAiChange('course_g37_makeover', 'les_g37_1');
  const restoredHook37 = sandbox.parseStructuredSectionData(g37Course.lessons[0].sections.s37_hook, 'example');
  assert(restoredHook37.setup.includes('check notifications every 6 minutes'), 'undoLastStudioAiChange accurately restored previous lesson snapshot');

  // Verify Desktop Drag & Drop + Speech/Dictation Draft Stability
  assert(typeof sandbox.handleStudioComposerDrop === 'function', 'handleStudioComposerDrop is a function');
  assert(typeof sandbox.handleStudioComposerInput === 'function', 'handleStudioComposerInput is a function');
  assert(indexHtml.includes('id="studio-composer-dropzone"') && indexHtml.includes('ondrop="handleStudioComposerDrop'), 'AI Composer and panel expose native drag and drop handlers');
  assert(indexHtml.includes('oncompositionstart=') && indexHtml.includes('!event.isComposing'), 'AI Composer guards live dictation/IME composition from premature Enter submission or height thrash');

  // Simulate dictated draft inside prompt and verify it survives background identical cloud sync AND file drop
  const promptMock = getOrCreateElem('input-studio-class-ai-prompt');
  promptMock.value = 'Please include a warm mashal about listening';
  sandbox.handleStudioComposerInput(promptMock, 'les_g37_1', { isComposing: true });

  const sameIso = new Date().toISOString();
  sandbox.APP_STATE.customCourses.forEach(c => { if (c) c.updated_at = sameIso; });
  const cloudSnapshot = JSON.parse(JSON.stringify(sandbox.APP_STATE.customCourses));
  const redundantSync = sandbox.mergeCustomCoursesWithCloud(cloudSnapshot, sameIso, []);
  assert(redundantSync === false, 'Identical background 15s cloud sync does NOT trigger destructive Studio re-render');

  // Simulate desktop text file drag & drop while dictated draft is in composer
  sandbox.handleStudioComposerDrop(
    {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: {
        files: [{ name: 'desktop_notes.txt', type: 'text/plain', size: 120, extractedText: 'Desktop lesson outline on Bitachon' }]
      }
    },
    'course_g37_makeover',
    'les_g37_1'
  );
  assert(g37Course.lessons[0].ai_sources.some(s => s.label === 'desktop_notes.txt'), 'handleStudioComposerDrop attaches dropped desktop files directly to AI sources');
  assert(getOrCreateElem('tutor-hub-lessons-container').innerHTML.includes('Please include a warm mashal about listening'), 'Composer preserves dictated/typed draft across re-renders after file drop');

  // Simulate dropped plain text snippet appending cleanly
  sandbox.handleStudioComposerDrop(
    {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: {
        files: [],
        getData: (t) => (t === 'text/plain' ? 'Also keep it short' : '')
      }
    },
    'course_g37_makeover',
    'les_g37_1'
  );
  assert(getOrCreateElem('input-studio-class-ai-prompt').value.includes('Also keep it short'), 'handleStudioComposerDrop appends dropped text snippets into composer');

  sandbox.fetch = prevFetch37;

  // --- GATE 38: Guided AI Tab Student Onboarding & Complete Student Profile Makeover ---
  console.log('\n--- Running Gate 38: Guided AI Student Onboarding & Student Profile Makeover ---');
  assert(typeof sandbox.startAiAddStudentOnboarding === 'function', 'startAiAddStudentOnboarding is a function');
  assert(typeof sandbox.createStudentFromAiPendingProfile === 'function', 'createStudentFromAiPendingProfile is a function');
  assert(typeof sandbox.toggleStudentDrawerCrmEdit === 'function', 'toggleStudentDrawerCrmEdit is a function');
  assert(typeof sandbox.toggleStudentDrawerAi === 'function', 'toggleStudentDrawerAi is a function');
  assert(typeof sandbox.sendStudentProfileAiMessage === 'function', 'sendStudentProfileAiMessage is a function');
  assert(typeof sandbox.undoStudentProfileAiChange === 'function', 'undoStudentProfileAiChange is a function');

  sandbox.APP_STATE.aiMessages = [];
  sandbox.applyAiQuickPrompt('add_student');
  assert(sandbox.APP_STATE.aiPendingStudent && sandbox.APP_STATE.aiPendingStudent.active === true, 'Clicking Add student in AI tab initiates guided student onboarding flow');
  const aiGuideHtml = getOrCreateElem('ai-chat-messages').innerHTML;
  assert(aiGuideHtml.includes('What is the student') && aiGuideHtml.includes('Create Profile'), 'AI onboarding asks simple 4-5 skip-optional questions upfront');

  // Mock Gemini response merging partial answers cleanly across onboarding
  const prevFetch38 = sandbox.fetch;
  let aiMode = 'onboarding';
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: aiMode === 'onboarding'
              ? JSON.stringify({
                  assistant_reply: 'Great! I prepared Ethan Levi\'s profile card below. Click Create Profile whenever ready.',
                  draft: {
                    name: 'Ethan Levi',
                    subject: 'Jewish Foundations',
                    gradeLevel: 'Middle School (6th - 8th)',
                    teachingDuration: '6 months',
                    notes: 'Loves basketball analogies, strong Hebrew decoding.',
                    customGoals: ['Master weekly Shabbat concept']
                  }
                })
              : JSON.stringify({
                  assistant_reply: 'Updated Ethan\'s homework, added mother Sarah contact, and added fluency goal.',
                  updates: {
                    guardianName: 'Sarah Levi',
                    guardianPhone: '+1 555-7788',
                    homeworkTask: 'Read page 4 twice aloud',
                    addGoals: ['Read fluidly without vowel hesitations']
                  }
                })
          }]
        }
      }]
    })
  });

  getOrCreateElem('ai-chat-input').value = 'His name is Ethan Levi, age 12, learning Jewish Foundations for 6 months, loves basketball';
  await sandbox.handleSendAiMessage();
  const draftChatHtml = getOrCreateElem('ai-chat-messages').innerHTML;
  assert(draftChatHtml.includes('Ethan Levi') && draftChatHtml.includes('btn-ai-create-student-profile'), 'AI onboarding renders live student preview card with Create Profile button');

  const createdEthan = sandbox.createStudentFromAiPendingProfile();
  assert(!!createdEthan && createdEthan.name === 'Ethan Levi', 'createStudentFromAiPendingProfile creates Ethan Levi in APP_STATE.students');
  assert(sandbox.APP_STATE.aiPendingStudent === null, 'Onboarding state clears cleanly after Create Profile');
  assert(!getOrCreateElem('drawer-student-detail').classList.contains('hidden'), 'Creating student from AI automatically opens clean redesigned Student Profile Drawer');

  // Verify Clean Student Profile Layout: no blank CRM input wall at rest, no double ++, structured numbered lesson list
  const ethanBodyHtml = getOrCreateElem('drawer-body-content').innerHTML;
  assert(!ethanBodyHtml.includes('drawer-crm-edit-card'), 'Redesigned Student Profile hides blank CRM form inputs at rest for calm readability');
  assert(!ethanBodyHtml.includes('+ +'), 'Redesigned Student Profile eliminates duplicate ++ icons on buttons');
  assert(ethanBodyHtml.includes('drawer-student-notes-input') && ethanBodyHtml.includes('studio-autogrow'), 'Tutor Notes renders full-width auto-growing dir="auto" textarea');
  assert(ethanBodyHtml.includes('Time vs Space: The Architecture of Shabbat') && ethanBodyHtml.includes('1'), 'Enrolled Courses render clean vertical numbered Lesson List');

  // Verify Edit Info toggles inline CRM fields cleanly when clicked
  sandbox.toggleStudentDrawerCrmEdit(createdEthan.id);
  assert(getOrCreateElem('drawer-body-content').innerHTML.includes('drawer-crm-edit-card'), 'Clicking Edit Info expands inline CRM & Guardian editor cleanly');
  sandbox.toggleStudentDrawerCrmEdit(createdEthan.id);

  // Verify post-creation AI profile updates & 1-click Undo
  aiMode = 'profile_update';
  sandbox.toggleStudentDrawerAi(createdEthan.id);
  assert(getOrCreateElem('drawer-body-content').innerHTML.includes('drawer-student-ai-panel'), 'In-drawer AI Student Assistant opens cleanly');
  getOrCreateElem('input-student-drawer-ai-prompt').value = 'Add mom Sarah 555-7788, assign reading homework, add fluency goal';
  await sandbox.sendStudentProfileAiMessage(createdEthan.id);
  assert(createdEthan.parentContact.name === 'Sarah Levi' && createdEthan.skills.homework.task.includes('Read page 4'), 'In-drawer AI Assistant enriches student profile after creation');
  assert(getOrCreateElem('drawer-body-content').innerHTML.includes('btn-undo-student-ai'), 'In-drawer AI Assistant displays Undo AI rollback button');

  sandbox.undoStudentProfileAiChange(createdEthan.id);
  assert(!createdEthan.parentContact.name && !createdEthan.skills.homework.task, 'undoStudentProfileAiChange accurately restores student snapshot');

  // Verify clicking a lesson inside Student Profile opens M99 Clean Lesson Reader
  sandbox.navigateToLesson('course_g37_makeover', 'les_g37_1');
  assert(getOrCreateElem('drawer-student-detail').classList.contains('hidden'), 'navigateToLesson closes student drawer smoothly');
  assert(getOrCreateElem('tutor-hub-lessons-container').innerHTML.includes('studio-lesson-reader'), 'navigateToLesson lands directly in Screen 3 Clean Lesson Reader');

  sandbox.fetch = prevFetch38;

  // --- GATE 39: Course Approved AI Resources Whitelist & Strict Lesson Generation Guard ---
  console.log('\n--- Running Gate 39: Course Approved AI Resources Whitelist ---');
  assert(indexHtml.includes('id="input-architect-allowed-resources"'), 'HTML includes Allowed Resources textarea in Course Architect');
  assert(indexHtml.includes('id="chk-architect-strict-resources"'), 'HTML includes Strict ONLY resources toggle in Course Architect');
  assert(typeof sandbox.buildCourseAllowedResourcesPromptRule === 'function', 'buildCourseAllowedResourcesPromptRule is defined');

  const strictRule = sandbox.buildCourseAllowedResourcesPromptRule({
    allowed_resources: 'Chumash & Rashi, Likutei Sichos, Sefer HaChinuch',
    strict_resources_only: true
  });
  assert(strictRule.includes('STRICT ALLOWED RESOURCES POLICY') && strictRule.includes('Likutei Sichos'), 'Strict mode emits mandatory whitelist policy prompt');
  const prefRule = sandbox.buildCourseAllowedResourcesPromptRule({
    allowed_resources: 'Campbell Biology 12th Ed',
    strict_resources_only: false
  });
  assert(prefRule.includes('PREFERRED APPROVED COURSE RESOURCES') && prefRule.includes('Campbell Biology'), 'Non-strict mode emits preferred resources prompt');

  // Test Architect AI updating allowed_resources, saving course, rehydrating on edit, and showing in View Rules
  sandbox.openCreateCourseModal('ai');
  getOrCreateElem('input-create-course-title-en').value = 'Chumash Intensive Track';
  sandbox.applyArchitectBlueprintUpdate({
    student_profile: 'Teen Yeshiva prep',
    guidelines: 'Direct textual analysis',
    allowed_resources: 'Chumash Bereishit with Rashi & Likutei Sichos Vol 1',
    strict_resources_only: true,
    sections: [{ type: 'quote', name: 'Rashi Text' }, { type: 'text', name: 'Sicha Insight' }]
  });
  assert(getOrCreateElem('input-architect-allowed-resources').value.includes('Likutei Sichos Vol 1'), 'applyArchitectBlueprintUpdate updates Allowed Resources input');

  getOrCreateElem('ai-builder-lessons-count-unified').value = 'blueprint';
  await sandbox.handleGenerateFullCourseFromAi();
  const resCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'Chumash Intensive Track');
  assert(!!resCourse && resCourse.blueprint.allowed_resources.includes('Chumash Bereishit'), 'Saved course persists blueprint.allowed_resources');
  assert(resCourse.blueprint.strict_resources_only === true, 'Saved course persists strict_resources_only flag');

  // Rehydrate on Edit Course modal
  getOrCreateElem('input-architect-allowed-resources').value = '';
  sandbox.openEditCustomCourseModal(resCourse.id);
  assert(getOrCreateElem('input-architect-allowed-resources').value.includes('Likutei Sichos Vol 1'), 'openEditCustomCourseModal rehydrates allowed_resources accurately');
  sandbox.closeCreateCourseModal();

  // Verify View Rules & ALL lesson AI prompts transmit the strict whitelist
  sandbox.handleStudioAddNewClassQuick(resCourse.id);
  const resLesson = resCourse.lessons[0];
  resLesson.title_en = 'Vayeira: The Test of Chesed';
  sandbox.enterStudioEditLessonMode(resCourse.id, resLesson.id);
  const studioHtml39 = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(studioHtml39.includes('Approved AI Resources') && studioHtml39.includes('Likutei Sichos Vol 1'), 'Course Blueprint View Rules displays Approved AI Resources whitelist');

  const prevFetch39 = sandbox.fetch;
  const g39Prompts = [];
  sandbox.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    g39Prompts.push(JSON.stringify(body));
    if (g39Prompts.length === 1) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ assistant_reply: 'Drafted strictly from Chumash & Rashi and Likutei Sichos.', sections: {} }) }] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sections: { [resCourse.blueprint.sections[0].id]: { quote_text: 'Rashi excerpt' } } }) }] } }] }) };
  };

  getOrCreateElem('input-studio-class-ai-prompt').value = 'Draft insights for this class';
  await sandbox.sendStudioClassAiMessage(resCourse.id, resLesson.id);
  assert(g39Prompts[0].includes('STRICT ALLOWED RESOURCES POLICY') && g39Prompts[0].includes('Chumash Bereishit with Rashi'), 'sendStudioClassAiMessage enforces course Approved Resources whitelist');

  sandbox.openStudioAiCoPilotModal(resCourse.id, resLesson.id);
  await sandbox.executeStudioAiGenerateFullClass();
  assert(g39Prompts[1] && g39Prompts[1].includes('STRICT ALLOWED RESOURCES POLICY'), 'executeStudioAiGenerateFullClass enforces course Approved Resources whitelist');

  sandbox.fetch = prevFetch39;

  // --- GATE 40: Dual Login Gate, Student Codes & Strictly Isolated Student Portal ---
  console.log('\n--- Running Gate 40: Dual Login Gate, Student Codes & Isolated Student Portal ---');
  assert(indexHtml.includes('id="tab-lock-role-teacher"') && indexHtml.includes('id="tab-lock-role-student"'), 'Lock screen exposes both Teacher Login and Student Login tabs');
  assert(indexHtml.includes('id="student-login-name"') && indexHtml.includes('id="student-login-code"'), 'Student Login form includes Exact Name and Access Code inputs');
  assert(typeof sandbox.generateStudentAccessCode === 'function', 'generateStudentAccessCode is a function');
  assert(typeof sandbox.handleStudentPortalLogin === 'function', 'handleStudentPortalLogin is a function');
  assert(typeof sandbox.regenerateStudentAccessCode === 'function', 'regenerateStudentAccessCode is a function');
  assert(typeof sandbox.addStudentSharedNote === 'function', 'addStudentSharedNote is a function');
  assert(typeof sandbox.toggleStudentPortalHomework === 'function', 'toggleStudentPortalHomework is a function');
  assert(typeof sandbox.toggleStudentPortalGoal === 'function', 'toggleStudentPortalGoal is a function');
  assert(typeof sandbox.logoutStudentPortal === 'function', 'logoutStudentPortal is a function');

  // Create student with Private Tutor Notes, Guardian Billing, Homework, Goals & Shared Student Note
  const g40Student = {
    id: 'stu_portal_test_40',
    name: 'Noam Ben-Ari',
    subject: 'Algebra Foundations',
    gradeLevel: 'Middle School (7th)',
    gradeOrDate: 'Spring 2027',
    hourlyRate: '$95/hr',
    parentContact: { name: 'Miriam Ben-Ari', phone: '+1 555-3210', email: 'miriam@secret.com' },
    notes: 'PRIVATE TEACHER NOTE: Parent asked about focus struggles and billing balance.',
    skills: {
      homework: { task: 'Solve exercises 1 to 5 on quadratic factoring', assignedDate: 'Nov 18', completed: false },
      customGoals: [{ id: 'goal_40_1', title: 'Master factoring without calculator', completed: false }]
    },
    schedule: [{ id: 'sess_40_1', dateStr: '2099-12-10', time: '5:00 PM', topic: 'Teacher secret outline', status: 'scheduled' }],
    sharedNotes: []
  };
  sandbox.ensureStudentSkills(g40Student);
  assert(/^[A-Z0-9]{6}$/.test(g40Student.studentAccessCode), 'ensureStudentSkills automatically generates unique 6-character alphanumeric Student Access Code');

  sandbox.APP_STATE.students = [g40Student];
  sandbox.saveStudentsToStorage(false);

  // Add shared student note from teacher drawer
  sandbox.openStudentDrawer(g40Student.id);
  const teacherDrawerHtml = getOrCreateElem('drawer-body-content').innerHTML;
  assert(teacherDrawerHtml.includes('drawer-student-portal-access-card') && teacherDrawerHtml.includes(g40Student.studentAccessCode), 'Teacher Student Profile displays Portal Access Code card');
  assert(teacherDrawerHtml.includes('Private · Teacher Only') && teacherDrawerHtml.includes('drawer-shared-notes-card'), 'Teacher Student Profile separates Private Notes from Shared Notes for Student');

  getOrCreateElem('input-drawer-shared-note').value = 'Remember to review the purple worksheet before Thursday!';
  sandbox.addStudentSharedNote(g40Student.id);
  assert(g40Student.sharedNotes.length === 1, 'addStudentSharedNote attaches custom shared note cleanly');

  // Verify Regenerate Code invalidates old code
  const oldCode40 = g40Student.studentAccessCode;
  sandbox.regenerateStudentAccessCode(g40Student.id);
  assert(g40Student.studentAccessCode !== oldCode40 && /^[A-Z0-9]{6}$/.test(g40Student.studentAccessCode), 'regenerateStudentAccessCode issues fresh unique 6-character code');
  sandbox.saveStudentsToStorage(false);
  sandbox.closeStudentDrawer();

  // Fail login on wrong code or wrong name
  getOrCreateElem('student-login-name').value = 'Noam Ben-Ari';
  getOrCreateElem('student-login-code').value = oldCode40;
  const oldCodeRejected = await sandbox.handleStudentPortalLogin();
  assert(oldCodeRejected === false && !sandbox.isStudentPortalActive(), 'Student login rejects revoked access code');

  getOrCreateElem('student-login-name').value = 'Wrong Name';
  getOrCreateElem('student-login-code').value = g40Student.studentAccessCode;
  const wrongNameRejected = await sandbox.handleStudentPortalLogin();
  assert(wrongNameRejected === false && !sandbox.isStudentPortalActive(), 'Student login rejects mismatching student name');

  // Succeed login with Exact Name + Current Access Code
  getOrCreateElem('student-login-name').value = 'noam ben-ari';
  getOrCreateElem('student-login-code').value = g40Student.studentAccessCode;
  const loginOk = await sandbox.handleStudentPortalLogin();
  assert(loginOk === true && sandbox.isStudentPortalActive() === true, 'Student login succeeds when exact name and access code match');

  // Strict Data & Chrome Isolation Checks
  assert(sandbox.APP_STATE.students.length === 0 && sandbox.APP_STATE.customCourses.length === 0, 'Student Portal session keeps teacher students & courses arrays strictly empty');
  assert(getOrCreateElem('teacher-header-controls').classList.contains('hidden'), 'Student Portal hides teacher header controls');
  assert(getOrCreateElem('main-bottom-dock').classList.contains('hidden'), 'Student Portal hides teacher bottom dock navigation');
  assert(!getOrCreateElem('view-student-portal').classList.contains('hidden'), 'Student Portal view container is visible');

  sandbox.switchTab('study');
  assert(getOrCreateElem('view-study').classList.contains('hidden'), 'switchTab is hard-blocked while logged in as student');

  // Content Visibility & Privacy Boundaries
  const portalHtml = getOrCreateElem('view-student-portal').innerHTML;
  assert(portalHtml.includes('Solve exercises 1 to 5 on quadratic factoring'), 'Student Portal renders student Homework');
  assert(portalHtml.includes('Master factoring without calculator'), 'Student Portal renders Assignments & Goals');
  assert(portalHtml.includes('Remember to review the purple worksheet before Thursday!'), 'Student Portal renders Shared Notes posted for student');
  assert(portalHtml.includes('2099-12-10') && portalHtml.includes('5:00 PM'), 'Student Portal renders upcoming session date & time');
  assert(!portalHtml.includes('PRIVATE TEACHER NOTE') && !portalHtml.includes('$95/hr') && !portalHtml.includes('miriam@secret.com') && !portalHtml.includes('Teacher secret outline'), 'Student Portal NEVER exposes private tutor notes, billing rate, guardian email, or teacher lesson notes');

  // Interactive Check-offs sync back cleanly
  sandbox.toggleStudentPortalHomework();
  assert(sandbox.APP_STATE.studentPortalStudent.skills.homework.completed === true, 'Student can mark Homework completed inside Student Portal');
  sandbox.toggleStudentPortalGoal('goal_40_1');
  assert(sandbox.APP_STATE.studentPortalStudent.skills.customGoals[0].completed === true, 'Student can mark Assignment/Goal completed inside Student Portal');

  // Clean Logout restores lock screen in Student Login mode
  sandbox.logoutStudentPortal();
  assert(!sandbox.isStudentPortalActive() && getOrCreateElem('view-student-portal').classList.contains('hidden'), 'logoutStudentPortal terminates isolated student session cleanly');
  assert(!getOrCreateElem('lock-screen').classList.contains('hidden'), 'logoutStudentPortal returns safely to authentication lock screen');

  // --- Gate 41: Clean My Courses Directory, Icon Normalization & Exact Title Preservation ---
  console.log('\n--- Running Gate 41: Clean My Courses Directory, Course Icon Normalization & Exact Title Preservation ---');
  assert(typeof sandbox.normalizeCourseIcon === 'function', 'normalizeCourseIcon is a function');
  assert(sandbox.normalizeCourseIcon('scroll') === '📜', 'normalizeCourseIcon converts raw keyword "scroll" into clean 📜 emoji');
  assert(sandbox.normalizeCourseIcon('book-open') === '📖', 'normalizeCourseIcon converts Lucide keyword "book-open" into clean 📖 emoji');
  assert(sandbox.normalizeCourseIcon('unmapped_keyword_xyz') === '✦', 'normalizeCourseIcon replaces unknown ASCII icon text with safe ✦ fallback instead of overflowing card badge');
  assert(sandbox.normalizeCourseIcon('🎵') === '🎵', 'normalizeCourseIcon keeps valid emoji icons intact');

  // Verify My Courses grid renders clean vertical layout without truncating titles or leaking raw "scroll" text
  sandbox.APP_STATE.customCourses = [
    {
      id: 'course_g41_chumash',
      title_en: 'Chumash Weekly Parsha Foundations For Beginners',
      icon: 'scroll',
      color: 'amber',
      lessons: [{ id: 'l_g41_1', lesson_num: 1, title_en: 'Bereshis' }]
    }
  ];
  sandbox.renderCoursesCardsGrid();
  const g41GridHtml = getOrCreateElem('courses-cards-grid').innerHTML;
  assert(indexHtml.includes('id="courses-cards-grid" class="flex flex-col gap-3"'), 'My Courses grid uses clean single-column stacked row layout');
  assert(g41GridHtml.includes('📜') && !g41GridHtml.includes('>scroll<') && !g41GridHtml.includes('font-mono'), 'Course badge displays normalized 📜 emoji and never renders raw ASCII "scroll" text');
  assert(!g41GridHtml.includes('truncate'), 'Course card title wraps naturally without chopping words with truncate');

  // Exact Course Title preservation in Architect even when user title is set or AI returns embellished subtitle
  sandbox.openCreateCourseModal('ai');
  getOrCreateElem('input-create-course-title-en').value = 'Chumash';
  sandbox.applyArchitectBlueprintUpdate({
    course_title_en: 'Journey Through the Chumash: Ancient Roots & Relevance',
    forceTitle: true,
    suggested_icon: 'scroll',
    sections: [{ type: 'text', name: 'Story', ai_rule: 'Plain summary' }]
  });
  assert(getOrCreateElem('input-create-course-title-en').value === 'Chumash', 'applyArchitectBlueprintUpdate strictly preserves exact user-entered course name verbatim');
  assert(getOrCreateElem('input-create-course-icon').value === '📜', 'applyArchitectBlueprintUpdate normalizes suggested_icon "scroll" into 📜');

  // Offline fallback keeps exact short title called by user instead of inventing marketing phrases
  sandbox.openCreateCourseModal('ai');
  sandbox.fetch = async () => { throw new Error('Network offline'); };
  getOrCreateElem('input-ai-blueprint-prompt').value = 'Chumash';
  await sandbox.handleAiSuggestBlueprint();
  assert(getOrCreateElem('input-create-course-title-en').value === 'Chumash', 'AI Architect fallback uses exact course name specified by teacher instead of "Chumash & Parsha Insights"');

  // handleGenerateCurriculum preserves explicit user course name verbatim over Gemini's embellished title_en
  getOrCreateElem('input-create-course-title-en').value = 'My Custom Chumash';
  getOrCreateElem('ai-builder-topic').value = 'My Custom Chumash';
  getOrCreateElem('ai-builder-domain').value = 'Chumash';
  getOrCreateElem('ai-builder-level').value = 'Middle School';
  getOrCreateElem('ai-builder-lessons-count').value = '2';
  getOrCreateElem('ai-builder-language').value = 'English';
  getOrCreateElem('ai-builder-guidance').value = '';
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              title_en: 'Journey Through the Sacred Chumash Mastery',
              title_he: 'חומש',
              icon: 'scroll',
              lessons: [{ lesson_num: 1, title_en: 'Intro', hook_en: 'Hook', anchors_en: ['Point 1'] }]
            })
          }]
        }
      }]
    })
  });
  await sandbox.handleGenerateCurriculum({ preventDefault() {} });
  const generatedCourse = sandbox.APP_STATE.customCourses.find(c => c.title_en === 'My Custom Chumash');
  assert(!!generatedCourse && generatedCourse.icon === '📜', 'handleGenerateCurriculum locks exact course name verbatim and normalizes returned icon');

  // --- Gate 42: Studio Focus/Dictation Immunity & Resilient Draft-to-Sections AI ---
  console.log('\n--- Running Gate 42: Studio Focus/Dictation Immunity & Resilient AI Draft Application ---');
  assert(typeof sandbox.resolveSectionUpdatesFromAiPayload === 'function', 'resolveSectionUpdatesFromAiPayload is a function');
  sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com', role: 'super_admin', id: 'teacher_g42' };

  const g42Course = {
    id: 'course_g42_studio',
    title_en: 'Chumash',
    title_he: 'חומש',
    created_by: 'shmueldoviduhlman@gmail.com',
    updated_at: new Date().toISOString(),
    blueprint: {
      version: '2.0',
      student_profile: '13 yr old teen',
      guidelines: 'Interactive',
      sections: [
        { id: 'sec_g42_intro', type: 'text', name: 'Relatable Opening Dilemma', ai_rule: 'Modern dilemma' },
        { id: 'sec_g42_points', type: 'list', name: 'Core Takeaways', ai_rule: 'Bullet list' }
      ]
    },
    lessons: [
      { id: 'les_g42_1', lesson_num: 1, title_en: 'Lesson 1', title_he: 'שיעור 1', sections: {} }
    ]
  };
  sandbox.APP_STATE.customCourses = [g42Course];
  sandbox.APP_STATE.insideCourseId = g42Course.id;
  sandbox.APP_STATE.activeCourseId = g42Course.id;
  sandbox.APP_STATE.studioSelectedLessonId = 'les_g42_1';
  sandbox.studioScreenMode = 'edit';
  sandbox.renderCourseStudio(g42Course.id, 'les_g42_1');

  // 1. Focus / typing immunity during 15s mergeStudentsWithCloud & renderAllViews
  const promptField = getOrCreateElem('input-studio-class-ai-prompt');
  const studioContainerEl = getOrCreateElem('course-studio-wrapper');
  const lessonsCont = getOrCreateElem('tutor-hub-lessons-container');
  promptField.tagName = 'TEXTAREA';
  studioContainerEl.contains = (node) => node === promptField;
  sandbox.document.activeElement = promptField;
  assert(sandbox.isStudioUserActivelyEditing() === true, 'isStudioUserActivelyEditing detects focused studio input/textarea');

  const sentinelMarker = '<!-- ACTIVE_FOCUS_SENTINEL -->';
  lessonsCont.innerHTML = lessonsCont.innerHTML + sentinelMarker;
  sandbox.studioPendingCloudRender = false;

  // Identical cloud students snapshot does NOT call renderAllViews or wipe studio DOM
  const currentStuSnapshot = JSON.parse(JSON.stringify(sandbox.APP_STATE.students || []));
  sandbox.mergeStudentsWithCloud(currentStuSnapshot);
  assert(lessonsCont.innerHTML.includes(sentinelMarker), 'mergeStudentsWithCloud with unchanged students preserves studio focus and DOM');

  // Even when renderAllViews fires during active editing, studio DOM is deferred instead of stealing focus
  sandbox.renderAllViews();
  assert(lessonsCont.innerHTML.includes(sentinelMarker) && sandbox.studioPendingCloudRender === true, 'renderAllViews defers rebuilding Studio DOM while user is actively typing/dictating');

  // Active local edit timestamp shields local typed lesson from older realtime cloud echoes
  sandbox.handleStudioUpdateClassField(g42Course.id, 'les_g42_1', 'sections.sec_g42_intro', 'LIVE TYPED DRAFT');
  const olderCloudCourse = JSON.parse(JSON.stringify(g42Course));
  olderCloudCourse.lessons[0].sections = { sec_g42_intro: 'STALE CLOUD VERSION' };
  olderCloudCourse.updated_at = new Date(Date.now() + 2000).toISOString();
  sandbox.mergeCustomCoursesWithCloud([olderCloudCourse], olderCloudCourse.updated_at, []);
  assert(g42Course.lessons[0].sections.sec_g42_intro === 'LIVE TYPED DRAFT', 'mergeCustomCoursesWithCloud protects live typed edits from overwriting during active save window');

  // autoGrowStudioTextarea never collapses height during speech/IME composing
  const mockArea = { style: { height: '120px' }, clientHeight: 120, scrollHeight: 120, value: 'speaking' };
  sandbox.autoGrowStudioTextarea(mockArea, { isComposing: true });
  assert(mockArea.style.height === '120px', 'autoGrowStudioTextarea preserves height cleanly during speech/IME composition');

  sandbox.document.activeElement = null;

  // 2. Resilient Section Resolution: maps Section Names and JSON-stringified objects cleanly
  const resolvedByName = sandbox.resolveSectionUpdatesFromAiPayload({
    sections: {
      'Relatable Opening Dilemma': JSON.stringify({ summary: 'Modern Test', body: 'You get offered free concert tickets...' }),
      'Core Takeaways': ['**Honesty**: Build trust first']
    }
  }, g42Course.blueprint.sections);
  assert(resolvedByName.sec_g42_intro !== undefined && resolvedByName.sec_g42_points !== undefined, 'resolveSectionUpdatesFromAiPayload maps human section names back to cryptic blueprint IDs');
  const parsedIntro = JSON.parse(sandbox.normalizeSectionAiValue(resolvedByName.sec_g42_intro, 'text'));
  assert(parsedIntro._structured === true && parsedIntro.summary === 'Modern Test' && parsedIntro.body.includes('concert tickets'), 'normalizeSectionAiValue parses JSON-stringified objects without double-escaping');

  // 3. Self-healing AI execution: when initial AI reply leaves sections: {} on a draft submission, follow-up populates sections directly
  let aiAttempt = 0;
  sandbox.fetch = async () => {
    aiAttempt++;
    if (aiAttempt === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ assistant_reply: 'Great draft idea!', sections: {} }) }] } }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                sections: {
                  sec_g42_intro: { summary: 'Peer Pressure Test', body: 'When your friends dare you to skip studying...' },
                  sec_g42_points: { items: ['**Inner Compass**: Decide before pressure hits'] }
                }
              })
            }]
          }
        }]
      })
    };
  };
  await sandbox.sendStudioClassAiMessage(g42Course.id, 'les_g42_1', 'Here is my draft: start with a story about peer pressure and give one main takeaway.');
  assert(aiAttempt >= 2, 'sendStudioClassAiMessage runs self-healing section pass when initial reply omitted sections for a draft');
  assert(String(g42Course.lessons[0].sections.sec_g42_intro || '').includes('Peer Pressure Test'), 'Draft content is applied cleanly into blueprint intro section');
  assert(lessonsCont.innerHTML.includes('Updated 2 sections'), 'AI Co-Builder chat bubble surfaces confirmation badge showing exact updated section count');

  // --- Gate 43: Smart AI Task Routing, Sticky-Lite Fix, Timeout Failover & Cloudflare /api/ai Proxy ---
  console.log('\n--- Running Gate 43: Smart AI Task Routing, Sticky-Lite Fix, PII Scrubbing & Cloudflare Edge Proxy ---');
  assert(sandbox.GEMINI_CANDIDATE_MODELS[0] === 'gemini-3-flash-preview', 'GEMINI_CANDIDATE_MODELS leads with flagship gemini-3-flash-preview ahead of -lite models');
  assert(typeof sandbox.getGeminiCandidateModelsForTier === 'function', 'getGeminiCandidateModelsForTier is defined');
  assert(sandbox.getGeminiCandidateModelsForTier('pro')[0] === 'gemini-3.1-pro-preview', 'Pro taskTier prioritizes gemini-3.1-pro-preview');
  assert(sandbox.getGeminiCandidateModelsForTier('standard')[0] === 'gemini-3-flash-preview', 'Standard taskTier prioritizes gemini-3-flash-preview');
  assert(sandbox.getGeminiCandidateModelsForTier('fast')[0] === 'gemini-3.5-flash-lite', 'Fast taskTier routes lightweight tasks to flash-lite');

  // Poisoned sticky -lite or stalling model in localStorage is automatically evicted on standard routing
  sandbox.APP_STATE.geminiModel = 'gemini-3.8-flash';
  sandbox.localStorage.setItem('tutor_gemini_model', 'gemini-3.8-flash');
  const rescuedQueue = sandbox.getGeminiCandidateModelsForTier('standard');
  assert(rescuedQueue[0] === 'gemini-3-flash-preview' && sandbox.localStorage.getItem('tutor_gemini_model') === null, 'getGeminiCandidateModelsForTier evicts poisoned/stalling model from localStorage');

  // Timeout/AbortError on slow primary model cleanly fails over to fast next candidate model instead of hanging forever
  sandbox.fetch = async (url) => {
    if (url.includes('gemini-3-flash-preview:')) {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Timeout failover succeeded' }] } }] })
    };
  };
  const timeoutFailoverRes = await sandbox.callGeminiApi('Quick ping', null, { taskTier: 'standard' });
  assert(timeoutFailoverRes === 'Timeout failover succeeded', 'callGeminiApi cleanly fails over to next model when primary model stalls/aborts on timeout');

  // Fallback to -lite during a temporary outage does NOT permanently lock localStorage.tutor_gemini_model
  sandbox.fetch = async (url) => {
    if (!url.includes('-lite:')) {
      return { ok: false, status: 503, json: async () => ({ error: { message: 'Temporary overload' } }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Emergency lite response' }] } }] })
    };
  };
  const liteFallbackRes = await sandbox.callGeminiApi('Quick ping', null, { taskTier: 'standard' });
  assert(liteFallbackRes === 'Emergency lite response', 'callGeminiApi succeeds on emergency -lite overflow during overload');
  assert(sandbox.localStorage.getItem('tutor_gemini_model') === null, 'callGeminiApi NEVER permanently locks weak -lite model into localStorage');

  // Standard / Deep Pro Toggle state & UI persistence
  assert(typeof sandbox.setAiQualityTier === 'function', 'setAiQualityTier is defined');
  sandbox.setAiQualityTier('pro');
  assert(sandbox.getAiQualityTier() === 'pro' && sandbox.localStorage.getItem('tutor_ai_quality_tier') === 'pro', 'setAiQualityTier persists Deep Pro preference cleanly');
  sandbox.setAiQualityTier('standard');
  assert(sandbox.getAiQualityTier() === 'standard' && sandbox.localStorage.getItem('tutor_ai_quality_tier') === 'standard', 'setAiQualityTier switches back to Standard Fast mode cleanly');
  assert(indexHtml.includes('data-ai-tier-pill="pro"') && indexHtml.includes('Deep Pro'), 'Architect & Studio expose Standard / Deep Pro toggle pills');

  // Privacy: getPortalContextData scrubs sensitive PII & guardian contacts before sending to AI
  sandbox.APP_STATE.students = [{
    id: 'stu_g43_pii',
    name: 'Noam Levy',
    subject: 'Chumash',
    hourlyRate: '$95/hr',
    studentAccessCode: 'XYZ999',
    parentContact: { name: 'Sarah Levy', phone: '555-888-1234', email: 'sarah@private.org' },
    notes: 'Call parent at 555-888-1234 or email sarah@private.org regarding Thursday makeup.'
  }];
  const safeAiContextStr = JSON.stringify(sandbox.getPortalContextData());
  assert(!safeAiContextStr.includes('555-888-1234') && !safeAiContextStr.includes('sarah@private.org') && !safeAiContextStr.includes('$95/hr') && !safeAiContextStr.includes('XYZ999'), 'getPortalContextData scrubs guardian contacts, phone numbers, emails, fees, and portal codes');
  assert(safeAiContextStr.includes('[redacted-phone]') && safeAiContextStr.includes('[redacted-email]'), 'getPortalContextData masks embedded phone/email PII inside teacher notes');

  // Verify Cloudflare Pages Function proxy module (functions/api/ai.js)
  const proxySrc = fs.readFileSync(path.join(__dirname, 'functions/api/ai.js'), 'utf8');
  assert(proxySrc.includes('export async function onRequestPost') && proxySrc.includes('X-TutorPilot-Role'), 'functions/api/ai.js implements Cloudflare Pages Function proxy with role checks');
  assert(proxySrc.includes('ALLOWED_GEMINI_MODELS') && proxySrc.includes('incrementAndCheckQuota'), 'functions/api/ai.js enforces model allowlist and per-user daily quota limiting');

  // Behavioral test of proxy logic (role block, unconfigured secret fallback, quota cap)
  const proxyCommonJs = proxySrc.replace(/export async function /g, 'async function ') + '\nmodule.exports = { onRequestPost, onRequestOptions };';
  const proxySandbox = {
    module: { exports: {} },
    exports: {},
    Response: class {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.headers = init.headers || {};
      }
      async text() { return this.body; }
      async json() { return JSON.parse(this.body); }
    },
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Proxied OK' }] } }] }) }),
    Date, Math, Set, Map, JSON, String, Number, parseInt, encodeURIComponent, Object, Array
  };
  proxySandbox.exports = proxySandbox.module.exports;
  vm.runInNewContext(proxyCommonJs, proxySandbox);
  const { onRequestPost } = proxySandbox.module.exports;

  const mkReq = (bodyObj, hdrs = {}) => ({
    headers: { get: (k) => hdrs[k] || hdrs[k.toLowerCase()] || '' },
    json: async () => bodyObj
  });

  const stuBlockedResp = await onRequestPost({ request: mkReq({ model: 'gemini-3.8-flash', payload: {} }, { 'X-TutorPilot-Role': 'student_portal' }), env: { GEMINI_API_KEY: 'secret' } });
  assert(stuBlockedResp.status === 403, 'Edge proxy rejects Student Portal accounts with HTTP 403');

  const unconfigResp = await onRequestPost({ request: mkReq({ model: 'gemini-3.8-flash', payload: {} }, { 'CF-Connecting-IP': '1.2.3.4' }), env: {} });
  assert(unconfigResp.status === 503 && (await unconfigResp.json()).fallbackDirect === true, 'Edge proxy signals fallbackDirect: true when GEMINI_API_KEY env secret is unset');

  const okResp1 = await onRequestPost({ request: mkReq({ model: 'gemini-3.8-flash', payload: {} }, { 'CF-Connecting-IP': '9.9.9.9' }), env: { GEMINI_API_KEY: 'server-secret', AI_DAILY_LIMIT: '2' } });
  assert(okResp1.status === 200 && okResp1.headers['X-TutorPilot-Proxy'] === 'cloudflare-pages', 'Edge proxy forwards request securely when GEMINI_API_KEY is configured');
  await onRequestPost({ request: mkReq({ model: 'gemini-3.8-flash', payload: {} }, { 'CF-Connecting-IP': '9.9.9.9' }), env: { GEMINI_API_KEY: 'server-secret', AI_DAILY_LIMIT: '2' } });
  const quotaExceededResp = await onRequestPost({ request: mkReq({ model: 'gemini-3.8-flash', payload: {} }, { 'CF-Connecting-IP': '9.9.9.9' }), env: { GEMINI_API_KEY: 'server-secret', AI_DAILY_LIMIT: '2' } });
  assert(quotaExceededResp.status === 429 && (await quotaExceededResp.json()).quotaExceeded === true, 'Edge proxy blocks excessive requests beyond AI_DAILY_LIMIT with HTTP 429');

  // --- Gate 44: In-Flight Cloud Sync Race Immunity & Empty-Section Object Guard ---
  console.log('\n--- Running Gate 44: In-Flight Cloud Sync Race Immunity & Empty-Section Guard ---');
  assert(typeof sandbox.beginCourseAiLock === 'function' && typeof sandbox.resolveLiveCourseAndLesson === 'function', 'Course AI lock & live resolution helpers are defined');
  assert(sandbox.normalizeSectionAiValue({}, 'text') === '', 'normalizeSectionAiValue rejects empty {} objects instead of creating blank _structured placeholders');
  assert(sandbox.normalizeSectionAiValue({ summary: '', body: '' }, 'text') === '', 'normalizeSectionAiValue rejects all-empty structured objects');
  assert(sandbox.normalizeSectionAiValue({ orig: 'בראשית', trans: 'In the beginning' }, 'bilingual_split').includes('"rows"'), 'normalizeSectionAiValue upgrades flat bilingual_split keys into valid rows array');

  const g44Course = {
    id: 'course_g44_race',
    title_en: 'Chumash',
    title_he: 'חומש',
    created_by: 'shmueldoviduhlman@gmail.com',
    updated_at: new Date().toISOString(),
    blueprint: {
      version: '2.0',
      student_profile: 'Parashah students',
      sections: [
        { id: 'sec_g44_overview', type: 'text', name: 'PARASHA OVERVIEW', ai_rule: 'Core summary' },
        { id: 'sec_g44_chazal', type: 'bilingual_split', name: 'VOICES OF CHAZAL', ai_rule: 'Rashi / Chazal text' },
        { id: 'sec_g44_living', type: 'reflection', name: 'LIVING THE TORAH', ai_rule: 'Weekly action' }
      ]
    },
    lessons: [
      { id: 'les_g44_1', lesson_num: 1, title_en: 'Lesson 1: New Lesson', sections: {}, ai_chat_history: [] }
    ]
  };
  sandbox.APP_STATE.currentUser = { email: 'shmueldoviduhlman@gmail.com', role: 'super_admin' };
  sandbox.APP_STATE.customCourses = [g44Course];
  sandbox.APP_STATE.insideCourseId = g44Course.id;
  sandbox.APP_STATE.activeCourseId = g44Course.id;
  sandbox.APP_STATE.studioSelectedLessonId = 'les_g44_1';
  sandbox.studioScreenMode = 'edit';

  // Simulate cloud sync firing mid-flight WHILE Gemini is drafting (plus initial empty {} values from model)
  let g44CallCount = 0;
  sandbox.fetch = async () => {
    g44CallCount++;
    // Fire stale cloud echo mid-flight containing blank sections & no chat
    const staleCloudSnapshot = [{
      id: 'course_g44_race',
      title_en: 'Chumash',
      created_by: 'shmueldoviduhlman@gmail.com',
      updated_at: new Date(Date.now() + 3000).toISOString(),
      blueprint: g44Course.blueprint,
      lessons: [{ id: 'les_g44_1', lesson_num: 1, title_en: 'Lesson 1: New Lesson', sections: {}, ai_chat_history: [] }]
    }];
    sandbox.mergeCustomCoursesWithCloud(staleCloudSnapshot, staleCloudSnapshot[0].updated_at, []);

    if (g44CallCount === 1) {
      // Simulate Gemini mistakenly returning empty section shells on attempt 1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ assistant_reply: 'Drafted!', sections: { sec_g44_overview: {}, sec_g44_chazal: {}, sec_g44_living: {} } }) }] } }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                sections: {
                  sec_g44_overview: { summary: 'Creation reveals divine purpose', body: 'Everything begins with intentionality and responsibility.' },
                  sec_g44_chazal: { rtl: true, rows: [{ orig: 'בראשית ברא אלקים', trans: 'In the beginning — For the sake of Torah and Israel (Rashi)' }] },
                  sec_g44_living: { mindset: 'Every small beginning shapes the whole world.', action: 'Start one new mitzvah habit this week.' }
                }
              })
            }]
          }
        }]
      })
    };
  };

  await sandbox.triggerStudioQuickAutoDraftClass(g44Course.id, 'les_g44_1', 'draft');
  const liveAfterCourse = sandbox.APP_STATE.customCourses.find(c => c.id === 'course_g44_race');
  const liveAfterLesson = liveAfterCourse.lessons[0];
  assert(String(liveAfterLesson.sections.sec_g44_overview || '').includes('Creation reveals divine purpose'), 'Auto-Draft writes real PARASHA OVERVIEW content into live APP_STATE course even across mid-flight cloud sync');
  assert(String(liveAfterLesson.sections.sec_g44_chazal || '').includes('בראשית ברא אלקים'), 'Auto-Draft populates VOICES OF CHAZAL bilingual rows cleanly');
  assert(String(liveAfterLesson.sections.sec_g44_living || '').includes('Start one new mitzvah habit'), 'Auto-Draft populates LIVING THE TORAH reflection fields cleanly');
  assert(liveAfterLesson.ai_chat_history.some(m => m.role === 'user') && liveAfterLesson.ai_chat_history.some(m => m.role === 'assistant' && m.updatedCount === 3), 'AI chat history retains both user request and assistant confirmation pill despite mid-flight cloud sync');

  // --- Gate 45: Clean AI Output (Zero Raw Markdown Asterisks / Backticks in Lesson & Chat Text) ---
  console.log('\n--- Running Gate 45: Clean AI Text Output & Legacy Markdown Cleanup ---');
  assert(typeof sandbox.stripAiMarkdownFormatting === 'function', 'stripAiMarkdownFormatting helper is exported');
  const messySample = 'Parashat Bereshit opens with the **creation of the universe** out of nothingness (*Yesh Mi\'Ayin*). Also check `code` and ***Shabbat***.';
  const cleanedSample = sandbox.stripAiMarkdownFormatting(messySample);
  assert(!cleanedSample.includes('*') && !cleanedSample.includes('`') && cleanedSample.includes('creation of the universe') && cleanedSample.includes("(Yesh Mi'Ayin)"), 'stripAiMarkdownFormatting cleanly strips **bold**, *italic*, ***both***, and backticks');

  const mathSample = 'Multiply 3 * 4 to get 12 cleanly';
  assert(sandbox.stripAiMarkdownFormatting(mathSample) === mathSample, 'stripAiMarkdownFormatting preserves spaced multiplication expressions like 3 * 4');

  const normText = JSON.parse(sandbox.normalizeSectionAiValue({ summary: '**Bereshit Overview**', body: messySample }, 'text'));
  assert(!normText.summary.includes('*') && !normText.body.includes('*') && !normText.body.includes('`'), 'normalizeSectionAiValue eliminates markdown asterisks and backticks before saving text sections');

  const normList = JSON.parse(sandbox.normalizeSectionAiValue({ items: ['* **First Idea**: Live intentionally', '**Second Idea**: Care for creation'] }, 'list'));
  assert(normList.items[0] === 'First Idea: Live intentionally' && !normList.items[1].includes('*'), 'normalizeSectionAiValue cleans bullet list items of leading asterisks and bold syntax');

  const legacyCourseG45 = {
    id: 'course_g45_legacy',
    title_en: 'Chumash',
    blueprint: {
      sections: [
        { id: 'sec_g45_over', type: 'text', name: 'PARASHA OVERVIEW' }
      ]
    },
    lessons: [
      {
        id: 'les_g45_1',
        lesson_num: 1,
        title_en: 'Parashat Bereshit',
        sections: {
          sec_g45_over: JSON.stringify({
            _structured: true,
            summary: '**In the Beginning**',
            body: messySample
          })
        }
      }
    ]
  };
  const renderedEditCard = sandbox.renderCustomBlueprintSectionCard(
    legacyCourseG45,
    legacyCourseG45.lessons[0],
    legacyCourseG45.blueprint.sections[0],
    { color: 'cyan', icon: 'file-text', placeholder: 'Main explanation...' }
  );
  assert(!renderedEditCard.includes('**creation of the universe**') && !renderedEditCard.includes('(*Yesh Mi\'Ayin*)') && renderedEditCard.includes('creation of the universe'), 'renderCustomBlueprintSectionCard strips legacy markdown asterisks from Studio textarea boxes');
  assert(!renderedEditCard.includes('(supports **bold**'), 'Studio main explanation textarea placeholder does not encourage raw markdown asterisks');

  const inlineItalicCheck = sandbox.formatSectionInlineText('Nothingness (*Yesh Mi\'Ayin*)');
  assert(inlineItalicCheck.includes('<em class="italic') && !inlineItalicCheck.includes('*'), 'formatSectionInlineText converts single-asterisk italics to clean HTML without leaving raw asterisks');

  sandbox.APP_STATE.customCourses.push(legacyCourseG45);
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              assistant_reply: 'Updated **PARASHA OVERVIEW** with *clear* themes.',
              sections: {
                sec_g45_over: {
                  summary: '**Moral Awakening**',
                  body: 'Parashat Bereshit highlights **Shabbat** and **Man (Adam)**.'
                }
              }
            })
          }]
        }
      }]
    })
  });
  await sandbox.sendStudioClassAiMessage(legacyCourseG45.id, 'les_g45_1', 'Write an overview for Parashat Bereshit.');
  const updatedG45Section = String(legacyCourseG45.lessons[0].sections.sec_g45_over || '');
  const lastG45Reply = legacyCourseG45.lessons[0].ai_chat_history[legacyCourseG45.lessons[0].ai_chat_history.length - 1];
  assert(!updatedG45Section.includes('*') && updatedG45Section.includes('Shabbat'), 'sendStudioClassAiMessage stores clean plain text without asterisks in section JSON');
  assert(!String(lastG45Reply.text || '').includes('*') && lastG45Reply.text.includes('clear'), 'sendStudioClassAiMessage strips markdown asterisks from Co-Builder chat replies');

  // --- Gate 46: Course-Level Lesson Builder Playbook, Dead Model Removal, Sefaria/Link Grounding & Safe Retry on Error ---
  console.log('\n--- Running Gate 46: Course Lesson Builder Playbook, Model Resilience & Safe Failure Guard ---');
  assert(indexHtml.includes('id="input-architect-lesson-instructions"'), 'Course Architect modal exposes Lesson Builder Playbook textarea');
  assert(typeof sandbox.retryStudioClassAiMessage === 'function' && typeof sandbox.fetchReadableUrlExtract === 'function', 'retryStudioClassAiMessage and fetchReadableUrlExtract helpers are exported');

  // Dead hanging models removed from live fallback queues
  const proQueue = sandbox.getGeminiCandidateModelsForTier('pro');
  const stdQueue = sandbox.getGeminiCandidateModelsForTier('standard');
  assert(!proQueue.includes('gemini-3.7-flash') && !proQueue.includes('gemini-3.8-flash'), 'Pro candidate queue removes hanging gemini-3.7-flash and dead gemini-3.8-flash models');
  assert(!stdQueue.includes('gemini-3.7-flash') && !stdQueue.includes('gemini-3.8-flash'), 'Standard candidate queue removes hanging gemini-3.7-flash and dead gemini-3.8-flash models');

  // Apply Architect Blueprint Update persists lesson_builder_instructions & renders section AI rules
  const archInstrEl = sandbox.document.getElementById('input-architect-lesson-instructions');
  sandbox.applyArchitectBlueprintUpdate({
    course_title_en: 'Chumash Depth',
    student_profile: 'Age 13 students',
    guidelines: '45 min interactive',
    lesson_builder_instructions: 'Always open with the Parsha storyline from Rashi, contrast two commentaries side by side in Voices of Chazal, and end with a concrete weekly takeaway.',
    sections: [
      { id: 'sec_g46_over', type: 'text', name: 'PARASHA OVERVIEW', ai_rule: 'Summarize narrative arc cleanly in 2 paragraphs' },
      { id: 'sec_g46_flow', type: 'list', name: 'NARRATIVE FLOW', ai_rule: '5 sequential Torah milestones' }
    ]
  });
  assert(archInstrEl.value.includes('Voices of Chazal'), 'applyArchitectBlueprintUpdate syncs lesson_builder_instructions into Course Architect Playbook textarea');
  const archListEl = sandbox.document.getElementById('architect-sections-list');
  assert(archListEl.innerHTML.includes('Lesson AI Rule') && archListEl.innerHTML.includes('Summarize narrative arc cleanly'), 'Architect sections panel visibly displays per-section Lesson AI Rule textarea');

  // Create course and verify playbook persists & propagates to Lesson Co-Builder prompt + auto-Sefaria fetch
  const g46Course = {
    id: 'course_g46_playbook',
    title_en: 'Chumash',
    blueprint: {
      student_profile: 'Teenagers',
      guidelines: '45m interactive',
      lesson_builder_instructions: 'Synthesize Rashi and Sforno side by side and explain every technical term clearly.',
      allowed_resources: 'https://www.sefaria.org/Genesis.6.9\nChumash & Rashi',
      strict_resources_only: true,
      sections: [
        { id: 'sec_g46_over', type: 'text', name: 'PARASHA OVERVIEW', ai_rule: 'Storyline overview' }
      ]
    },
    lessons: [
      {
        id: 'les_g46_1',
        lesson_num: 1,
        title_en: 'Parashat Noach',
        sections: {
          sec_g46_over: JSON.stringify({ _structured: true, summary: 'Existing Saved Summary', body: 'Keep me intact on AI failure.' })
        },
        ai_chat_history: []
      }
    ]
  };
  sandbox.APP_STATE.customCourses.push(g46Course);
  sandbox.APP_STATE.insideCourseId = g46Course.id;
  sandbox.APP_STATE.activeCourseId = g46Course.id;
  sandbox.APP_STATE.studioSelectedLessonId = 'les_g46_1';
  sandbox.studioScreenMode = 'edit';

  // When all AI models fail temporarily, NEVER overwrite lesson sections with prompt-echo or fake "Core Point 1" junk
  sandbox.fetch = async (url) => {
    if (String(url).includes('sefaria.org/api/texts')) {
      return { ok: true, status: 200, json: async () => ({ ref: 'Genesis 6:9', text: 'These are the generations of Noah. Noah was a righteous man.', he: 'אלה תולדת נח נח איש צדיק תמים היה' }) };
    }
    return { ok: false, status: 503, json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }) };
  };
  await sandbox.sendStudioClassAiMessage(g46Course.id, 'les_g46_1', 'Please create a complete lesson parashat noach using the two provided links.');
  const preservedSection = JSON.parse(g46Course.lessons[0].sections.sec_g46_over);
  assert(preservedSection.body === 'Keep me intact on AI failure.', 'AI error never overwrites existing lesson sections with prompt echo or fake placeholder text');
  const errChatMsg = g46Course.lessons[0].ai_chat_history[g46Course.lessons[0].ai_chat_history.length - 1];
  assert(errChatMsg.isError === true && errChatMsg.retryPrompt.includes('parashat noach'), 'Failed AI reply attaches retryPrompt metadata for one-click recovery');
  assert(lessonsCont.innerHTML.includes('Retry Request'), 'Studio AI chat bubble renders one-click Retry Request button when AI fails');

  // Now retry with working Gemini mock and verify playbook + Sefaria extract were injected into prompt
  let capturedSysPrompt = '';
  let capturedUserPrompt = '';
  sandbox.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com') && opts && opts.body) {
      const parsedBody = JSON.parse(opts.body);
      capturedSysPrompt = parsedBody?.systemInstruction?.parts?.[0]?.text || '';
      capturedUserPrompt = parsedBody?.contents?.slice(-1)?.[0]?.parts?.[0]?.text || '';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  assistant_reply: 'Built Parashat Noach using your Course Playbook and Genesis 6:9.',
                  sections: {
                    sec_g46_over: { summary: 'Noah walks with G-d amidst corruption', body: 'In Genesis 6:9, Rashi and Sforno debate how Noah lived in his generation.' }
                  }
                })
              }]
            }
          }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const errIdx = g46Course.lessons[0].ai_chat_history.length - 1;
  await sandbox.retryStudioClassAiMessage(g46Course.id, 'les_g46_1', errIdx);
  assert(capturedSysPrompt.includes('MASTER LESSON BUILDER INSTRUCTIONS') && capturedSysPrompt.includes('Synthesize Rashi and Sforno'), 'sendStudioClassAiMessage injects Course Lesson Builder Playbook directly into Gemini systemInstruction');
  assert(capturedUserPrompt.includes('Noah was a righteous man'), 'sendStudioClassAiMessage automatically extracts Sefaria source links from Course Allowed Resources');
  assert(g46Course.lessons[0].sections.sec_g46_over.includes('Rashi and Sforno debate'), 'Retry updates lesson section cleanly with real AI output');

  // --- Gate 47: M105 Complete UI & UX Makeover (Warm Daylight Theme, Desktop Pill Nav, Unified Lesson Page, 3-Tab Architect, 2-Tab Student Profile, Split Calendar & AI Studio) ---
  console.log('\n--- Running Gate 47: M105 Complete UI & UX Makeover ---');
  assert(indexHtml.includes('class="theme-daylight overflow-x-hidden"') && indexHtml.includes('id="btn-theme-toggle"'), 'HTML defaults to Warm Daylight theme and exposes 1-click Theme Toggle button');
  assert(typeof sandbox.getThemeMode === 'function' && typeof sandbox.toggleThemeMode === 'function', 'Theme engine helpers getThemeMode and toggleThemeMode are defined');
  assert(sandbox.getThemeMode() === 'light', 'Default theme mode is Warm Daylight (light)');
  assert(sandbox.toggleThemeMode() === 'dark' && sandbox.localStorage.getItem('tutor_theme_mode') === 'dark', 'toggleThemeMode switches to Dark Mode and persists preference');
  assert(sandbox.toggleThemeMode() === 'light' && sandbox.localStorage.getItem('tutor_theme_mode') === 'light', 'toggleThemeMode switches back to Warm Daylight cleanly');

  // Desktop Left Sidebar App Shell + Parchment Scroll Toggle + Live Daily Overview Section
  assert(indexHtml.includes('id="app-sidebar-shell"') && indexHtml.includes('id="desktop-sidebar-nav"') && indexHtml.includes('id="btn-sidebar-scroll-toggle"') && indexHtml.includes('id="sidebar-daily-overview-section"') && !indexHtml.includes('id="btn-header-command-center"') && !indexHtml.includes('id="sidebar-courses-quick-list"') && indexHtml.includes('id="main-bottom-dock" class="md:hidden'), 'Desktop sidebar exposes parchment scroll toggle and inline Daily Overview section without nav Today button or Your Courses tree');
  assert(typeof sandbox.toggleSidebarScrollCollapse === 'function' && typeof sandbox.renderSidebarDailyOverview === 'function', 'toggleSidebarScrollCollapse and renderSidebarDailyOverview helpers are defined');
  assert(sandbox.toggleSidebarScrollCollapse() === true && sandbox.localStorage.getItem('tutor_sidebar_collapsed') === 'true', 'Clicking parchment scroll logo rolls sidebar closed cleanly');
  assert(sandbox.toggleSidebarScrollCollapse() === false && sandbox.localStorage.getItem('tutor_sidebar_collapsed') === 'false', 'Clicking parchment scroll logo again unrolls sidebar open cleanly');
  const g47PrevStudents = sandbox.APP_STATE.students;
  const g47TodayYMD = sandbox.formatDateToYMD(new Date());
  sandbox.APP_STATE.students = [
    { id: 'stu_daily_1', name: 'David Levi', status: 'active', schedule: [{ id: 'sd1', dateStr: g47TodayYMD, time: '4:30 PM', topic: 'Parashat Chayei Sarah' }] },
    { id: 'stu_daily_2', name: 'Paused Kid', status: 'paused', schedule: [] }
  ];
  sandbox.renderSidebarDailyOverview();
  const g47DailyHtml = getOrCreateElem('sidebar-daily-overview-body').innerHTML;
  assert(g47DailyHtml.includes('David Levi') && g47DailyHtml.includes('4:30 PM') && g47DailyHtml.includes('id="sidebar-daily-classes-count"') && g47DailyHtml.includes('>1</div>') && g47DailyHtml.includes('id="sidebar-daily-students-count"'), 'Live Daily Overview updates with today classes count, active student count, and scheduled student rows');
  sandbox.APP_STATE.students = g47PrevStudents;

  // Tab 1: 1-Click Continue Last Lesson, Top Lesson Switcher, Click-to-Rename Title, Quick Section Jump List & 3-Tab Course Architect
  const g47Course = {
    id: 'course_g47_ui',
    title_en: 'Chumash Mastery',
    blueprint: {
      sections: [
        { id: 'sec_g47_1', type: 'text', name: 'Parasha Overview' },
        { id: 'sec_g47_2', type: 'list', name: 'Core Milestones' }
      ]
    },
    lessons: [
      {
        id: 'les_g47_1',
        lesson_num: 1,
        title_en: 'Lesson 1: Bereshit',
        sections: {
          sec_g47_1: JSON.stringify({ _structured: true, summary: 'Duplicate Text', body: 'Duplicate Text' }),
          sec_g47_2: JSON.stringify({ _structured: true, items: ['Day 1 Light', 'Day 7 Shabbat'] })
        }
      },
      {
        id: 'les_g47_2',
        lesson_num: 2,
        title_en: 'Lesson 2: Noach',
        sections: {
          sec_g47_1: JSON.stringify({ _structured: true, summary: '', body: 'Noah builds the ark.' }),
          sec_g47_2: JSON.stringify({ _structured: true, items: ['The Flood', 'The Rainbow Covenant'] })
        }
      }
    ]
  };
  sandbox.APP_STATE.customCourses.push(g47Course);
  sandbox.openCourseClassesView('course_g47_ui');
  const g47SyllabusHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(!g47SyllabusHtml.includes('Sections Ready') && !g47SyllabusHtml.includes('Ready to Draft') && !g47SyllabusHtml.includes('Read &amp; Teach') && !g47SyllabusHtml.includes('Edit with AI'), 'Syllabus list displays strictly clean Lesson Number + Large Lesson Name without cluttered badges or extra card buttons');

  sandbox.selectStudioClass('les_g47_1');
  sandbox.renderCourseStudio('course_g47_ui', 'les_g47_1');
  const g47ReaderHtml = getOrCreateElem('tutor-hub-lessons-container').innerHTML;
  assert(!g47ReaderHtml.includes('id="reader-lesson-switcher-select"') && !g47ReaderHtml.includes('id="btn-reader-teach-class"') && !g47ReaderHtml.includes('id="lesson-section-jump-list"'), 'Lesson Page removes cluttered lesson dropdown, Teach Class button, and Sections jump list bar');
  assert(g47ReaderHtml.includes('id="btn-reader-edit-lesson"') && g47ReaderHtml.includes('Edit with AI'), 'Lesson Page exposes clean Edit with AI button at the top');
  assert(g47ReaderHtml.includes('contenteditable="true"') && g47ReaderHtml.includes('handleInlineLessonTitleRename'), 'Lesson Page title supports Click-to-Rename on the spot');
  const dupCount = (g47ReaderHtml.match(/Duplicate Text/g) || []).length;
  assert(dupCount === 1, 'Lesson Page deduplicates identical summary and body text so two identical text boxes never appear');

  // Test inline title rename & clean course cards (no card pencil/trash icons) + double-confirm delete helper
  sandbox.handleInlineLessonTitleRename('course_g47_ui', 'les_g47_1', 'Bereshit: Creation & Purpose');
  assert(g47Course.lessons[0].title_en === 'Bereshit: Creation & Purpose', 'handleInlineLessonTitleRename updates lesson title directly on the spot');
  assert(typeof sandbox.handleDeleteEditingCourseDoubleConfirm === 'function', 'Safe double-confirmation course deletion helper is defined');

  // Test Visual Course Cover Cards, Left Sidebar Quick Course Tree & Removal of Continue Last Lesson Banner
  sandbox.showAllCoursesView();
  const continueBannerEl = getOrCreateElem('continue-last-lesson-banner');
  assert(continueBannerEl.classList.contains('hidden') && continueBannerEl.innerHTML === '', 'Continue Last Lesson banner is permanently removed and hidden per user preference');
  const g47CardsHtml = getOrCreateElem('courses-cards-grid').innerHTML;
  assert(g47CardsHtml.includes('modern-gradient-cover') && !g47CardsHtml.includes('Click to open chapters') && !g47CardsHtml.includes('Structured interactive curriculum') && !g47CardsHtml.includes('handleDeleteCustomCourseById'), 'My Courses renders ultra-clean Visual Course Cards without filler descriptions, footer buttons, or exposed edit/delete clutter');

  // Test 3-Tab Course Architect Right Panel switcher
  assert(typeof sandbox.switchArchitectRightTab === 'function', 'switchArchitectRightTab is defined');
  sandbox.switchArchitectRightTab('playbook');
  assert(!getOrCreateElem('architect-tab-panel-playbook').classList.contains('hidden') && getOrCreateElem('architect-tab-panel-sections').classList.contains('hidden'), 'switchArchitectRightTab switches Course Architect to AI Playbook & Sources tab');
  sandbox.switchArchitectRightTab('sections');
  assert(!getOrCreateElem('architect-tab-panel-sections').classList.contains('hidden'), 'switchArchitectRightTab returns to Lesson Sections tab');

  // Tab 2: Clean Student Roster Cards & 2-Tab Student Profile
  sandbox.renderStudents();
  const g47RosterHtml = getOrCreateElem('students-list').innerHTML;
  assert(!g47RosterHtml.includes('moveStudentUp') && !g47RosterHtml.includes('moveStudentDown'), 'Student Roster Cards remove Up/Down arrow reorder clutter');
  const targetStu47 = sandbox.APP_STATE.students[0];
  sandbox.openStudentDrawer(targetStu47.id);
  const g47ProfileHtml = getOrCreateElem('drawer-body-content').innerHTML;
  assert(g47ProfileHtml.includes('id="student-profile-tabs-bar"') && g47ProfileHtml.includes('id="student-profile-panel-progress"') && g47ProfileHtml.includes('id="student-profile-panel-portal"'), 'Student Profile renders 2-tab layout separating Teacher Progress & Private Notes from Student Portal & Shared items');
  sandbox.switchStudentProfileTab(targetStu47.id, 'portal');
  assert(sandbox.studentProfileTabMap[targetStu47.id] === 'portal', 'switchStudentProfileTab switches to Student Portal & Shared tab');

  // Tab 3: Split Calendar Grid + Live Side Day Agenda Panel
  assert(indexHtml.includes('id="calendar-side-agenda-panel"') && typeof sandbox.renderCalendarSideAgendaPanel === 'function', 'Calendar tab includes Live Side Day Agenda Panel');
  sandbox.selectCalendarDayAgenda('2026-11-18');
  assert(getOrCreateElem('calendar-side-agenda-panel').innerHTML.includes('2026-11-18') && getOrCreateElem('calendar-side-agenda-panel').innerHTML.includes('btn-side-agenda-add-lesson'), 'selectCalendarDayAgenda updates Live Side Day Agenda Panel for clicked date');

  // Tab 4: Dedicated AI Studio Generator Cards
  assert(indexHtml.includes('id="ai-studio-generator-cards"') && indexHtml.includes('Worksheet & Handout') && indexHtml.includes('Speech & Dvar Torah'), 'Dedicated AI Studio tab displays 4 visual Teaching Generator & Assistant cards');

  console.log(`\n========================================`);
  console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} gates verified)`);
  console.log(`========================================\n`);
})();
