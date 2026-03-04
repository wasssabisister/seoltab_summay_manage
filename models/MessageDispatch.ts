import mongoose, { Document, Model, Schema } from 'mongoose';

const COLLECTION_PREFIX = process.env.MONGODB_COLLECTION_PREFIX || 'summury_';
const MESSAGE_DISPATCH_COLLECTION = `${COLLECTION_PREFIX}message_dispatches`;

export type DispatchChannel = 'kakao' | 'api';
export type DispatchStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface IMessageDispatch extends Document {
  idempotencyKey: string;
  channel: DispatchChannel;
  status: DispatchStatus;
  eventType: string;
  lvt?: string;
  sentForSchedule?: string;  // 어떤 일정에 대해 발송했는지 (예: "2026-02-12 19:00:00")
  studentUserNo?: string;
  recipientPhone?: string;
  recipientName?: string;
  templateId?: string;
  externalApiUrl?: string;
  payload?: Record<string, any>;
  response?: any;
  errorMessage?: string;
  attemptCount: number;
  maxRetry: number;
  lastAttemptAt?: Date;
  sentAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const MessageDispatchSchema = new Schema<IMessageDispatch>(
  {
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    channel: {
      type: String,
      enum: ['kakao', 'api'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      required: true,
      default: 'pending',
      index: true,
    },
    eventType: { type: String, required: true, index: true },
    lvt: { type: String, index: true },
    sentForSchedule: { type: String, index: true },  // 발송 대상 일정 (예: "2026-02-12 19:00:00")
    studentUserNo: { type: String, index: true },
    recipientPhone: { type: String, index: true },
    recipientName: { type: String },
    templateId: { type: String, index: true },
    externalApiUrl: { type: String },
    payload: { type: Schema.Types.Mixed },
    response: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
    attemptCount: { type: Number, default: 0 },
    maxRetry: { type: Number, default: 3 },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date, index: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: MESSAGE_DISPATCH_COLLECTION }
);

MessageDispatchSchema.index({ status: 1, updatedAt: -1 });
MessageDispatchSchema.index({ channel: 1, eventType: 1, createdAt: -1 });
MessageDispatchSchema.index({ studentUserNo: 1, eventType: 1, createdAt: -1 });
MessageDispatchSchema.index({ lvt: 1, eventType: 1, status: 1 });
MessageDispatchSchema.index({ lvt: 1, createdAt: -1 });
MessageDispatchSchema.index({ lvt: 1, sentForSchedule: 1, status: 1 });

export const MessageDispatch: Model<IMessageDispatch> =
  mongoose.models.MessageDispatch ||
  mongoose.model<IMessageDispatch>('MessageDispatch', MessageDispatchSchema);
