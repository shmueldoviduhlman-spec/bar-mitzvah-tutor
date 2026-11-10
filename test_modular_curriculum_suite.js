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
  scrollTo: () => {},
  window: {
    location: { href: 'https://bar-mitzvah-tutor.pages.dev' },
    addEventListener() {},
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
sandbox.APP_STATE.currentUser = { email: 'rabbiycloster@gmail.com' };
assert(sandbox.getActiveSchoolId() === 'school_main_770', 'Rabbi Closter resolves to school_main_770');
sandbox.APP_STATE.currentUser = { email: 'tutor@external.edu' };
assert(sandbox.getActiveSchoolId() === 'tutor_external_edu', 'External tutor without school resolves to user-scoped ID');
sandbox.APP_STATE.currentUser = { email: 'tutor@external.edu', school_id: 'school_main_770' };
assert(sandbox.getActiveSchoolId() === 'school_main_770', 'External tutor who joined school resolves to school_main_770');

// 4. Strict Individual Authentication via grantAuthSession
assert(typeof sandbox.grantAuthSession === 'function', 'grantAuthSession is a function');

// Test Shmuel Login: Super Admin identity preserved
sandbox.grantAuthSession({
  email: 'shmueldoviduhlman@gmail.com',
  name_en: 'Shmuel Dovid Uhlman (Lead Tutor)'
});
assert(sandbox.APP_STATE.currentUser.email === 'shmueldoviduhlman@gmail.com', 'Shmuel session has his own email');
assert(sandbox.APP_STATE.currentUser.role === 'super_admin', 'Shmuel session receives super_admin role');
assert(sandbox.APP_STATE.currentUser.name_en === 'Shmuel Dovid Uhlman (Lead Tutor)', 'Shmuel session preserves Shmuel full name');
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'Shmuel session attached to school_main_770');

// Test Rabbi Closter Login: Individual identity preserved (NOT overwritten with Shmuel's identity)
sandbox.grantAuthSession({
  email: 'rabbiycloster@gmail.com',
  name_en: 'Rabbi Y. Closter'
});
assert(sandbox.APP_STATE.currentUser.email === 'rabbiycloster@gmail.com', 'Rabbi Closter session has his own email');
assert(sandbox.APP_STATE.currentUser.name_en === 'Rabbi Y. Closter', 'Rabbi Closter session preserves his own name (not Shmuel)');
assert(sandbox.APP_STATE.currentUser.school_id === 'school_main_770', 'Rabbi Closter attached to shared school_main_770');
assert(sandbox.APP_STATE.currentUser.role === 'tutor', 'Rabbi Closter role is tutor');

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

console.log(`\n========================================`);
console.log(`ALL TESTS PASSED! (${passedTests}/${totalTests} gates verified)`);
console.log(`========================================\n`);
