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
  escapeHtml: s => String(s || '')
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

// Test Audio player rendering in expanded lesson
if (!sandbox.APP_STATE.expandedCustomLessonIds) sandbox.APP_STATE.expandedCustomLessonIds = {};
sandbox.APP_STATE.expandedCustomLessonIds[createdLesson.id] = true;
sandbox.renderLessonsCategoryView();
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
assert(!navBarElem.classList.contains('hidden'), 'study-courses-nav-bar is visible when courses exist');
const pillsContainer = getOrCreateElem('study-courses-pills-container');
assert(pillsContainer.innerHTML.includes('Graded Hebrew Reading'), 'Course picker renders pills for active courses');

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

// 9. Class Header Discreet Edit Pencil & Custom Section Display
sandbox.APP_STATE.expandedCustomLessonIds[blueprintLesson.id] = true;
sandbox.renderTutorHubActiveLessons(blueprintCourse.id);
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
assert(sandbox.I18N.en.tabStudy === 'Classes', 'I18N en tabStudy is Classes');
assert(sandbox.I18N.he.tabStudy === 'שיעורים', 'I18N he tabStudy is שיעורים');
assert(sandbox.I18N.en.mobStudy === 'Classes', 'I18N en mobStudy is Classes');
assert(sandbox.I18N.he.mobStudy === 'שיעורים', 'I18N he mobStudy is שיעורים');
assert(indexHtml.includes('id="mob-lbl-study">Classes<'), 'HTML mobile dock label is Classes');

// 2. Course-First Navigation & switchTab('classes') Alias
sandbox.switchTab('classes');
assert(sandbox.APP_STATE.activeTab === 'study', 'switchTab classes alias activates study tab');
assert(sandbox.APP_STATE.insideCourseId === null, 'Entering classes resets insideCourseId to null (Courses Directory)');

// 3. Clean Slate Onboarding Copy & Elements
assert(indexHtml.includes('Welcome to Classes'), 'HTML clean slate title welcomes educators to Classes');
assert(indexHtml.includes('+ Add a Course'), 'HTML clean slate contains prominent + Add a Course button');
assert(indexHtml.includes('Classes & Courses'), 'HTML courses directory header is Classes & Courses');

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

// 5. Command Center Collapsible Behavior
sandbox.APP_STATE.commandCenterCollapsed = false;
sandbox.toggleCommandCenterCollapse();
assert(sandbox.APP_STATE.commandCenterCollapsed === true, 'toggleCommandCenterCollapse sets collapsed to true');
const g25CmdBody = getOrCreateElem('command-center-body');
assert(g25CmdBody.classList.contains('hidden'), 'command-center-body is hidden when collapsed');
sandbox.toggleCommandCenterCollapse();
assert(sandbox.APP_STATE.commandCenterCollapsed === false, 'toggleCommandCenterCollapse sets collapsed to false');
assert(!g25CmdBody.classList.contains('hidden'), 'command-center-body is visible when expanded');

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

console.log(`\n========================================`);
console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} gates verified)`);
console.log(`========================================\n`);
