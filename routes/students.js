const express = require('express');
const { query } = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

async function getStudentId(userId) {
  const rows = await query('SELECT id FROM students WHERE user_id = ?', [userId]);
  return rows[0]?.id || null;
}

router.get('/dashboard', async (req, res) => {
  try {
    const studentId = await getStudentId(req.user.id);
    if (!studentId) return res.status(404).json({ success: false, message: 'Student profile not found' });
    const [info, courses, upcoming, grades, recentGrades] = await Promise.all([
      query(`SELECT u.name, s.roll_number, s.semester, s.gpa FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=?`, [studentId]),
      query(`SELECT c.id, c.code, c.name, c.credits, c.instructor_name, c.semester FROM enrollments e JOIN courses c ON e.course_id=c.id WHERE e.student_id=? AND e.status='active'`, [studentId]),
      query(`SELECT a.id, a.title, a.due_date, a.total_points, a.type, c.name as course_name, c.code as course_code,
             CASE WHEN g.id IS NOT NULL THEN 1 ELSE 0 END as is_submitted, g.score, g.letter_grade
             FROM assignments a JOIN courses c ON a.course_id=c.id
             JOIN enrollments e ON c.id=e.course_id AND e.student_id=?
             LEFT JOIN grades g ON a.id=g.assignment_id AND g.student_id=?
             WHERE a.status='published' AND a.due_date >= NOW() ORDER BY a.due_date ASC LIMIT 5`, [studentId, studentId]),
      query('SELECT percentage, letter_grade FROM grades WHERE student_id=?', [studentId]),
      query(`SELECT g.percentage, g.letter_grade, g.graded_at, a.title as assignment_title, c.name as course_name
             FROM grades g LEFT JOIN assignments a ON g.assignment_id=a.id JOIN courses c ON g.course_id=c.id
             WHERE g.student_id=? ORDER BY g.graded_at DESC LIMIT 5`, [studentId]),
    ]);
    const avgPct = grades.length ? Math.round(grades.reduce((s, g) => s + g.percentage, 0) / grades.length) : 0;
    res.json({ success: true, data: { student: info[0] || {}, stats: { enrolled_courses: courses.length, avg_percentage: avgPct, gpa: info[0]?.gpa || 0, total_grades: grades.length }, courses, upcoming_assignments: upcoming, recent_grades: recentGrades } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/courses', async (req, res) => {
  try {
    const studentId = await getStudentId(req.user.id);
    const courses = await query(`
      SELECT c.id, c.code, c.name, c.description, c.credits, c.semester,
             c.instructor_name, c.instructor_email, e.enrollment_date,
             COUNT(DISTINCT a.id) as total_assignments,
             COUNT(DISTINCT g.id) as graded_assignments,
             AVG(g.percentage) as avg_grade
      FROM enrollments e JOIN courses c ON e.course_id=c.id
      LEFT JOIN assignments a ON c.id=a.course_id AND a.status='published'
      LEFT JOIN grades g ON g.course_id=c.id AND g.student_id=?
      WHERE e.student_id=? AND e.status='active'
      GROUP BY c.id, c.code, c.name, c.description, c.credits, c.semester,
               c.instructor_name, c.instructor_email, e.enrollment_date
      ORDER BY c.semester, c.code
    `, [studentId, studentId]);
    res.json({ success: true, data: courses });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/assignments', async (req, res) => {
  try {
    const studentId = await getStudentId(req.user.id);
    const assignments = await query(`
      SELECT a.id, a.course_id, a.title, a.description, a.type, a.total_points,
             a.weight, a.due_date, a.status, c.name as course_name, c.code as course_code,
             CASE WHEN g.id IS NOT NULL THEN 1 ELSE 0 END as is_submitted,
             g.score, g.percentage, g.letter_grade, g.feedback, g.graded_at
      FROM assignments a JOIN courses c ON a.course_id=c.id
      JOIN enrollments e ON c.id=e.course_id AND e.student_id=?
      LEFT JOIN grades g ON a.id=g.assignment_id AND g.student_id=?
      WHERE a.status='published' ORDER BY a.due_date ASC
    `, [studentId, studentId]);
    res.json({ success: true, data: assignments });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/grades', async (req, res) => {
  try {
    const studentId = await getStudentId(req.user.id);
    const grades = await query(`
      SELECT g.id, g.student_id, g.course_id, g.assignment_id, g.score, g.max_score,
             g.percentage, g.letter_grade, g.feedback, g.graded_at,
             c.name as course_name, c.code as course_code, a.title as assignment_title
      FROM grades g JOIN courses c ON g.course_id=c.id
      LEFT JOIN assignments a ON g.assignment_id=a.id
      WHERE g.student_id=? ORDER BY g.graded_at DESC
    `, [studentId]);
    const summary = await query(`
      SELECT c.id, c.code, c.name, c.credits, AVG(g.percentage) as avg_pct, COUNT(g.id) as graded_count
      FROM grades g JOIN courses c ON g.course_id=c.id
      WHERE g.student_id=?
      GROUP BY c.id, c.code, c.name, c.credits
    `, [studentId]);
    const totalCredits = summary.reduce((s, c) => s + (c.credits || 0), 0);
    const weightedSum = summary.reduce((s, c) => { const pct = c.avg_pct || 0; const gp = pct >= 90 ? 4.0 : pct >= 80 ? 3.0 : pct >= 70 ? 2.0 : pct >= 60 ? 1.0 : 0.0; return s + gp * (c.credits || 0); }, 0);
    const cgpa = totalCredits ? (weightedSum / totalCredits).toFixed(2) : '0.00';
    res.json({ success: true, data: grades, summary, cgpa, total_credits: totalCredits });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/courses/:id', async (req, res) => {
  try {
    const studentId = await getStudentId(req.user.id);
    const course = await query('SELECT * FROM courses WHERE id=?', [req.params.id]);
    if (!course[0]) return res.status(404).json({ success: false, message: 'Course not found' });
    const [assignments, grades, classmates] = await Promise.all([
      query(`SELECT a.id, a.title, a.description, a.type, a.total_points, a.due_date, a.status,
             CASE WHEN g.id IS NOT NULL THEN 1 ELSE 0 END as submitted,
             g.score, g.percentage, g.letter_grade, g.feedback
             FROM assignments a LEFT JOIN grades g ON a.id=g.assignment_id AND g.student_id=?
             WHERE a.course_id=? AND a.status='published' ORDER BY a.due_date`, [studentId, req.params.id]),
      query(`SELECT id, score, max_score, percentage, letter_grade, feedback, graded_at
             FROM grades WHERE student_id=? AND course_id=?`, [studentId, req.params.id]),
      query(`SELECT u.name, s.roll_number FROM enrollments e
             JOIN students s ON e.student_id=s.id JOIN users u ON s.user_id=u.id
             WHERE e.course_id=? AND e.status='active' AND s.id != ? LIMIT 20`, [req.params.id, studentId]),
    ]);
    res.json({ success: true, data: { ...course[0], assignments, grades, classmates } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;