// Planning dates only. Working time and access are set when the teacher opens a lesson.
module.exports = {
  timezone: 'Asia/Ho_Chi_Minh',
  markingDeadlineDate: '2026-12-11',
  classes: [
    ['2B1','starter-codequest','2026-11-23','08:40','10:10',null],
    ['2B2','starter-codequest','2026-11-23','12:30','13:45','2026-11-30'],
    ['2B3','starter-codequest','2026-12-01','08:00','09:15','2026-12-08'],
    ['2B4','starter-codequest','2026-12-01','12:30','13:45','2026-12-08'],
    ['2B5','starter-codequest','2026-11-26','12:30','13:45',null],
    ['2B6','starter-codequest','2026-11-25','09:35','10:50','2026-12-02'],
    ['2B7','starter-codequest','2026-11-25','14:05','15:20','2026-12-02'],
    ['3B1','starter-data','2026-12-01','09:35','10:50','2026-12-08'],
    ['3B2','starter-data','2026-12-01','14:05','15:20','2026-12-08'],
    ['3B3','starter-data','2026-11-25','12:30','13:45','2026-12-02'],
    ['3B4','starter-data','2026-11-25','08:00','09:15','2026-12-09'],
    ['3B5','starter-data','2026-11-26','14:05','15:20','2026-12-10'],
    ['3B6','starter-data','2026-11-27','08:00','09:15','2026-12-04'],
    ['3B7','starter-data','2026-11-27','12:30','13:45','2026-12-04'],
  ].map(([className,templateId,date,start,end,replacement]) => ({ className,templateId,version:templateId === 'starter-data' ? 3 : 1,date,start,end,replacement })),
};
