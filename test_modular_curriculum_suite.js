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
      addEventListener() {}
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
  window: {
    location: { href: 'https://bar-mitzvah-tutor.pages.dev' },
    addEventListener() {},
    lucide: { createIcons() {} },
    confirm: () => true,
    alert: () => {},
    prompt: () => ''
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

sandbox.APP_STATE.currentUser = { email: 'RABBIYCLOSTER@GMAIL.COM' };
assert(sandbox.isMasterAccount() === true, 'rabbiycloster@gmail.com is identified as master account (case insensitive)');

sandbox.APP_STATE.currentUser = { email: 'admin@tutors.org', role: 'super_admin' };
assert(sandbox.isMasterAccount() === true, 'super_admin role is identified as master account');

// Test external tutor accounts
sandbox.APP_STATE.currentUser = { email: 'math_teacher@school.edu', role: 'authenticated' };
assert(sandbox.isMasterAccount() === false, 'External tutor is NOT identified as master account');

sandbox.APP_STATE.currentUser = null;
assert(sandbox.isMasterAccount() === false, 'Unauthenticated user is NOT identified as master account');

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

console.log(`\n========================================`);
console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} gates verified)`);
console.log(`========================================\n`);
