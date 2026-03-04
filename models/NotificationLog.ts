import mongoose, { Document, Model, Schema, Types } from 'mongoose';

const COLLECTION_PREFIX = process.env.MONGODB_COLLECTION_PREFIX || 'summury_';
const NOTIFICATION_LOG_COLLECTION = `${COLLECTION_PREFIX}notification_logs`;

export type NotificationChannel = 'sms' | 'kakao' | 'email' | 'api';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type NotificationTriggerType = 'manual' | 'cron' | 'event' | 'scheduled';

export interface INotificationLog extends Document {
  recipientPhone?: string;
  recipientName?: string;
  channel: NotificationChannel;
  templateKey?: string;
  message?: string;
  payload?: Record<string, any>;
  status: NotificationStatus;
  errorMessage?: string;
  sentAt?: Date;
  scheduledFor?: Date;
  triggerType: NotificationTriggerType;
  externalApiUrl?: string;
  externalApiResponse?: any;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationLogSchema = new Schema<INotificationLog>(
  {
    recipientPhone: { type: String, index: true },
    recipientName: { type: String },
    channel: {
      type: String,
      enum: ['sms', 'kakao', 'email', 'api'],
      required: true,
      index: true,
    },
    templateKey: { type: String, index: true },
    message: { type: String },
    payload: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    errorMessage: { type: String },
    sentAt: { type: Date, index: true },
    scheduledFor: { type: Date, index: true },
    triggerType: {
      type: String,
      enum: ['manual', 'cron', 'event', 'scheduled'],
      required: true,
      index: true,
    },
    externalApiUrl: { type: String },
    externalApiResponse: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: NOTIFICATION_LOG_COLLECTION }
);

NotificationLogSchema.index({ recipientPhone: 1, createdAt: -1 });
NotificationLogSchema.index({ triggerType: 1, status: 1, createdAt: -1 });

export const NotificationLog: Model<INotificationLog> =
  mongoose.models.NotificationLog ||
  mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema);
