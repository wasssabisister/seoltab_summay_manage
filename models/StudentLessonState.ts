import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IStudentLessonState extends Document {
  studentUserNo: string;
  status: string; // 상태 (진행중, 제외 등)
  lvt: string;
  firstActiveTimestamp: string;
  year: string;
  name: string;
  phoneNumber: string;
  tutoringState: string;
  totalDm: string;
  finalDone: string;
  subject: string;
  teacherUserNo: string;
  teacherName: string;
  ffTuda: string; // 현재 첫 수업 일자
  fsSs: string; // 첫 수업 상태
  nextScheduleDatetime: string; // 다음 수업 일자
  nextScheduleState: string; // 다음 수업 상태
  latestDoneUpdate: string; // 지난 수업 업데이트 시점
  latestDoneSchedule: string; // 지난 수업 일자
  latestAssignDatetime: string; // 현재 선생님 배정 시점
  
  // 상태 변경 추적
  previousState?: string; // 이전 상태
  stateChangedAt?: Date; // 상태 변경 시점
  lastSyncedAt: Date; // 마지막 동기화 시점
  
  // 메타데이터
  sourceSheetId?: string; // 시트 ID
  sourceSheetName?: string; // 시트 이름
  metadata?: Record<string, any>;
  
  createdAt: Date;
  updatedAt: Date;
}

const prefix = process.env.MONGODB_COLLECTION_PREFIX || 'summury_';

const StudentLessonStateSchema = new Schema<IStudentLessonState>(
  {
    studentUserNo: { type: String, index: true },
    status: { type: String, required: true, index: true },
    lvt: { type: String, required: true, unique: true, index: true },
    firstActiveTimestamp: { type: String },
    year: { type: String },
    name: { type: String, index: true },
    phoneNumber: { type: String, index: true },
    tutoringState: { type: String },
    totalDm: { type: String },
    finalDone: { type: String },
    subject: { type: String, index: true },
    teacherUserNo: { type: String, index: true },
    teacherName: { type: String },
    ffTuda: { type: String },
    fsSs: { type: String },
    nextScheduleDatetime: { type: String, index: true },
    nextScheduleState: { type: String, index: true },
    latestDoneUpdate: { type: String },
    latestDoneSchedule: { type: String },
    latestAssignDatetime: { type: String },
    
    // 상태 변경 추적
    previousState: { type: String },
    stateChangedAt: { type: Date },
    lastSyncedAt: { type: Date, default: Date.now, index: true },
    
    // 메타데이터
    sourceSheetId: { type: String },
    sourceSheetName: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: `${prefix}student_lesson_states` }
);

StudentLessonStateSchema.index({ status: 1, lastSyncedAt: -1 });
StudentLessonStateSchema.index({ studentUserNo: 1, subject: 1 });
StudentLessonStateSchema.index({ nextScheduleState: 1, nextScheduleDatetime: 1 });
StudentLessonStateSchema.index({ teacherUserNo: 1, subject: 1 });

export const StudentLessonState: Model<IStudentLessonState> =
  mongoose.models.StudentLessonState ||
  mongoose.model<IStudentLessonState>('StudentLessonState', StudentLessonStateSchema);
