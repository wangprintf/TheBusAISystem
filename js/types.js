/**
 * 后端建议的数据模型：
 * Alert { id, type, category: '机动车' | '非机动车' | '行人' | '道路', severity, status, confidence, occurredAt, route,
 *         location, longitude, latitude, deviceId, thumbnail, evidenceUrl, description }
 * WorkOrder { id, title, sourceAlertId, status, assignee, dueAt, updatedAt, location }
 * Device { id, name, route, status, network, storage, temperature, modelVersion, lastSeen }
 */
export const ALERT_STATUS = { pending: '待审核', valid: '有效', false: '误报', dispatched: '已转工单' };
export const WORK_ORDER_STATUS = { pending: '未处理', processing: '处理中', review: '待审核', completed: '已完成' };
