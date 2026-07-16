/**
 * 后端建议的数据模型：
 * Alert { id, type, category, severity, status, confidence, occurredAt, route,
 *         location, longitude, latitude, deviceId, thumbnail, evidenceUrl, description }
 * WorkOrder { id, title, sourceAlertId, status, assignee, dueAt, updatedAt, location }
 * Device { id, name, route, status, network, storage, temperature, modelVersion, lastSeen }
 */
export const ALERT_STATUS = { pending: '待审核', valid: '有效', false: '误报', dispatched: '已转工单' };
export const WORK_ORDER_STATUS = { pending: '未处理', processing: '处理中', completed: '已完成' };
