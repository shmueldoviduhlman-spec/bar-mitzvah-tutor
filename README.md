# TutorPilot: Universal Educator Operating System

TutorPilot is a modern, high performance web operating system designed for private tutors, educators, learning centers, and coaches across all academic disciplines. It unifies course and curriculum authoring, student CRM tracking, multi tutor school collaboration, calendar scheduling, and AI lesson generation into a single responsive application.

Production Deployment: [https://tutorpilot.pages.dev](https://tutorpilot.pages.dev)

---

## Core Capabilities

1. Modular Course and Curriculum Builder:
   • Create custom courses for any academic discipline (Mathematics, Sciences, Languages, Humanities, History, Arts, Test Prep, or Specialized Traditions).
   • Visual lesson studio with pedagogical frameworks: engagement hooks, structured knowledge anchors with bold keywords, deep conceptual case studies, real world applications, and interactive discussion prompts.
   • Ready to use curriculum templates and custom blueprint generators.

2. Student CRM and Progress Tracking:
   • Manage active rosters with customized primary subjects, grade levels, and private notes.
   • Track lesson completion, skills development, reading fluency, and capstone presentations.
   • Real time progress percentages and individual student portals.

3. Intelligent Calendar and Scheduling:
   • Clean Gregorian secular calendar with day and week views, quick time slots, and recurring weekly lessons.
   • Dedicated toggle for an optional Hebrew lunar calendar overlay with Shabbat highlighting when relevant.
   • Conflict detection and direct calendar to student lesson navigation.

4. Built In AI Pedagogical Studio:
   • Powered by Google Gemini with full tool calling capabilities.
   • Generate full multi section lessons, customized problem sets, and syllabus roadmaps in seconds.
   • Conversational assistant with live database awareness of students, courses, and schedules.

5. Multi Tutor School Collaboration:
   • School workspace joining with six digit codes and direct WhatsApp invite links.
   • Shared student database across educators with role based permissions.
   • Real time cloud synchronization via Supabase with offline first fallbacks.

6. Full Bilingual Support:
   • Instant one tap switch between English and Hebrew.
   • Automated right to left (RTL) alignment and font optimization.

---

## Quick Start Guide

### Open in Browser
Double click `index.html` to open directly in Google Chrome, Apple Safari, or Microsoft Edge.

### Local Development Preview
Run a local static server from the project directory:
```bash
python3 -m http.server 8080
```
Then navigate to `http://localhost:8080` in your web browser.

### Mobile Installation (PWA)
• iOS Safari: Tap Share -> Add to Home Screen.
• Android Chrome: Tap Menu (three dots) -> Install App or Add to Home Screen.

---

## Testing and Verification

Run the comprehensive automated testing suite:
```bash
node test_modular_curriculum_suite.js
```
The suite verifies curriculum blueprints, student CRM state, calendar toggles, bilingual dictionaries, and AI tool declarations across over 530 deterministic verification gates.
