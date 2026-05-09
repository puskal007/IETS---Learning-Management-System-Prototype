const express = require('express');
const { query } = require('../config/database');
const { auth, teacherOnly } = require('../middleware/auth');

const router = express.Router();
router.use(auth, teacherOnly);

async function getTeacherId(userId) {
  const rows = await query('SELECT id FROM teachers WHERE user_id = ?', [userId]);
  return rows[0]?.id || null;
}

router.get('/dashboard', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    if (!teacherId) return res.status(404).json({ success: false, message: 'Teacher profile not found' });
    const [courses, totalStudents, totalAssignments, pendingGrades, recentStudents] = await Promise.all([
      query(`SELECT c.id, c.code, c.name, c.credits, c.semester, COUNT(DISTINCT e.id) as enrolled
             FROM teacher_courses tc JOIN courses c ON tc.course_id = c.id
             LEFT JOIN enrollments e ON c.id = e.course_id AND e.status = 'active'
             WHERE tc.teacher_id = ?
             GROUP BY c.id, c.code, c.name, c.credits, c.semester`, [teacherId]),
      query(`SELECT COUNT(DISTINCT e.student_id) as c FROM teacher_courses tc
             JOIN enrollments e ON tc.course_id = e.course_id AND e.status = 'active'
             WHERE tc.teacher_id = ?`, [teacherId]),
      query(`SELECT COUNT(*) as c FROM assignments a
             JOIN teacher_courses tc ON a.course_id = tc.course_id
             WHERE tc.teacher_id = ?`, [teacherId]),
      query(`SELECT COUNT(DISTINCT e.student_id) as c FROM teacher_courses tc
             JOIN enrollments e ON tc.course_id = e.course_id AND e.status = 'active'
             LEFT JOIN grades g ON g.student_id = e.student_id AND g.course_id = e.course_id
             WHERE tc.teacher_id = ? AND g.id IS NULL`, [teacherId]),
      query(`SELECT DISTINCT u.name, u.email, s.roll_number, e.enrollment_date
             FROM teacher_courses tc
             JOIN enrollments e ON tc.course_id = e.course_id AND e.status = 'active'
             JOIN students s ON e.student_id = s.id JOIN users u ON s.user_id = u.id
             WHERE tc.teacher_id = ? ORDER BY e.enrollment_date DESC LIMIT 5`, [teacherId]),
    ]);
    res.json({ success: true, data: { stats: { assigned_courses: courses.length, total_students: totalStudents[0]?.c || 0, total_assignments: totalAssignments[0]?.c || 0, pending_grades: pendingGrades[0]?.c || 0 }, courses, recent_students: recentStudents } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/courses', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    if (!teacherId) return res.status(404).json({ success: false, message: 'Teacher profile not found' });
    const courses = await query(`
      SELECT c.id, c.code, c.name, c.description, c.credits, c.semester, c.department, c.status,
             COUNT(DISTINCT e.id) as enrolled_count, COUNT(DISTINCT a.id) as assignment_count
      FROM teacher_courses tc JOIN courses c ON tc.course_id = c.id
      LEFT JOIN enrollments e ON c.id = e.course_id AND e.status = 'active'
      LEFT JOIN assignments a ON c.id = a.course_id
      WHERE tc.teacher_id = ?
      GROUP BY c.id, c.code, c.name, c.description, c.credits, c.semester, c.department, c.status
      ORDER BY c.semester, c.code
    `, [teacherId]);
    res.json({ success: true, data: courses });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/courses/:id/students', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const check = await query('SELECT id FROM teacher_courses WHERE teacher_id=? AND course_id=?', [teacherId, req.params.id]);
    if (!check[0]) return res.status(403).json({ success: false, message: 'Not your course' });
    const students = await query(`
      SELECT s.id as student_id, u.name, u.email, s.roll_number, s.semester, s.gpa,
             g.score, g.percentage, g.letter_grade
      FROM enrollments e JOIN students s ON e.student_id = s.id JOIN users u ON s.user_id = u.id
      LEFT JOIN grades g ON g.student_id = s.id AND g.course_id = ?
      WHERE e.course_id = ? AND e.status = 'active' ORDER BY u.name
    `, [req.params.id, req.params.id]);
    res.json({ success: true, data: students });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/assignments', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const assignments = await query(`
      SELECT a.id, a.course_id, a.title, a.description, a.type, a.total_points,
             a.weight, a.due_date, a.status, a.created_by, a.created_at,
             c.name as course_name, c.code as course_code,
             COUNT(DISTINCT g.id) as graded_count,
             (SELECT COUNT(*) FROM enrollments WHERE course_id=a.course_id AND status='active') as enrolled_count
      FROM assignments a JOIN courses c ON a.course_id = c.id
      JOIN teacher_courses tc ON c.id = tc.course_id
      LEFT JOIN grades g ON a.id = g.assignment_id
      WHERE tc.teacher_id = ?
      GROUP BY a.id, a.course_id, a.title, a.description, a.type, a.total_points,
               a.weight, a.due_date, a.status, a.created_by, a.created_at, c.name, c.code
      ORDER BY a.due_date DESC
    `, [teacherId]);
    res.json({ success: true, data: assignments });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/assignments', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const { course_id, title, description, type = 'homework', total_points = 100, weight = 10, due_date, instructions } = req.body;
    if (!course_id || !title || !due_date) return res.status(400).json({ success: false, message: 'course_id, title, due_date required' });
    const check = await query('SELECT id FROM teacher_courses WHERE teacher_id=? AND course_id=?', [teacherId, course_id]);
    if (!check[0]) return res.status(403).json({ success: false, message: 'Not your course' });
    const result = await query(
      'INSERT INTO assignments (course_id, title, description, type, total_points, weight, due_date, instructions, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "published", ?)',
      [course_id, title, description || null, type, total_points, weight, due_date, instructions || null, req.user.name]
    );
    res.status(201).json({ success: true, message: 'Assignment created', id: result.insertId });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/assignments/:id', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const a = await query('SELECT a.course_id FROM assignments a JOIN teacher_courses tc ON a.course_id=tc.course_id WHERE a.id=? AND tc.teacher_id=?', [req.params.id, teacherId]);
    if (!a[0]) return res.status(403).json({ success: false, message: 'Not your assignment' });
    const { title, description, type, total_points, weight, due_date, status } = req.body;
    await query('UPDATE assignments SET title=?, description=?, type=?, total_points=?, weight=?, due_date=?, status=?, updated_at=NOW() WHERE id=?',
      [title, description || null, type || 'homework', total_points || 100, weight || 10, due_date, status || 'published', req.params.id]);
    res.json({ success: true, message: 'Assignment updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/assignments/:id', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const a = await query('SELECT a.id FROM assignments a JOIN teacher_courses tc ON a.course_id=tc.course_id WHERE a.id=? AND tc.teacher_id=?', [req.params.id, teacherId]);
    if (!a[0]) return res.status(403).json({ success: false, message: 'Not your assignment' });
    await query('UPDATE assignments SET status="closed" WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Assignment closed' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/grade', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const { student_id, course_id, assignment_id, score, max_score = 100, feedback } = req.body;
    const check = await query('SELECT id FROM teacher_courses WHERE teacher_id=? AND course_id=?', [teacherId, course_id]);
    if (!check[0]) return res.status(403).json({ success: false, message: 'Not your course' });
    const pct = Math.round((score / max_score) * 100);
    const letter = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
    await query(`INSERT INTO grades (student_id, course_id, assignment_id, score, max_score, percentage, letter_grade, feedback, graded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE score=VALUES(score), percentage=VALUES(percentage),
      letter_grade=VALUES(letter_grade), feedback=VALUES(feedback), graded_at=NOW()`,
      [student_id, course_id, assignment_id || null, score, max_score, pct, letter, feedback || null]);
    const grades = await query('SELECT percentage FROM grades WHERE student_id=?', [student_id]);
    if (grades.length) {
      const avg = grades.reduce((a, g) => a + g.percentage, 0) / grades.length;
      const gpa = avg >= 90 ? 4.0 : avg >= 80 ? 3.0 : avg >= 70 ? 2.0 : avg >= 60 ? 1.0 : 0.0;
      await query('UPDATE students SET gpa=? WHERE id=?', [gpa.toFixed(2), student_id]);
    }
    res.json({ success: true, message: 'Grade saved', letter_grade: letter, percentage: pct });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/courses/:id/grades', async (req, res) => {
  try {
    const teacherId = await getTeacherId(req.user.id);
    const check = await query('SELECT id FROM teacher_courses WHERE teacher_id=? AND course_id=?', [teacherId, req.params.id]);
    if (!check[0]) return res.status(403).json({ success: false, message: 'Not your course' });
    const grades = await query(`
      SELECT g.id, g.student_id, g.course_id, g.assignment_id, g.score, g.max_score,
             g.percentage, g.letter_grade, g.feedback, g.graded_at,
             u.name as student_name, s.roll_number, a.title as assignment_title
      FROM grades g JOIN students s ON g.student_id = s.id JOIN users u ON s.user_id = u.id
      LEFT JOIN assignments a ON g.assignment_id = a.id
      WHERE g.course_id = ? ORDER BY u.name
    `, [req.params.id]);
    res.json({ success: true, data: grades });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;