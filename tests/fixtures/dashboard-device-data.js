export const fixtureDevices = Array.from({ length: 20 }, (_, i) => ({
  id: `TEST-${String(i + 1).padStart(3, '0')}`, name: `测试车辆 ${i + 1}`,
  status: i < 12 ? '正常' : i < 17 ? '异常' : '离线',
  abnormalInfo: i < 12 ? '' : i === 12 ? '摄像头信号丢失，请检查视频连接线' : i < 17 ? '设备温度过高，散热风扇需要检修' : '',
  lastSeen: '测试数据', temperature: 54, storage: 62,
}));
export const fixtureOrders = Array.from({ length: 12 }, (_, i) => ({
  id: `WO-TEST-${i + 1}`, title: ['机动车违停', '路面坑洼', '道路设施损坏'][i % 3],
  status: ['pending', 'processing', 'review', 'completed'][i % 4],
  priority: ['高', '中', '低'][i % 3], severity: '高',
  latitude: 39.06 + i * 0.001, longitude: 117.13 + i * 0.001, category: '机动车',
  occurredAt: `2026-09-13 ${String(i + 8).padStart(2, '0')}:12:00`,
  location: '测试道路 · 示例交叉口', remarks: '', alertMedia: [], processedMedia: [],
}));
const failedOnce = new Set();
export const api = {
  getDashboard: async () => ({ todayAlerts: 12, validRate: 92, pendingOrders: 3, completed: 3, processing: 3, unprocessed: 3, trend: [2, 4, 1, 6, 3, 8, 12] }),
  getAlerts: async () => fixtureOrders.map(order => ({ ...order, id: `ALERT-${order.id}`, type: order.title })),
  getDevices: async () => structuredClone(fixtureDevices),
  getWorkOrders: async () => structuredClone(fixtureOrders),
  getWorkOrderAssignments: async () => fixtureOrders.map(order => ({ id: order.id, matchId: order.matchId || null, assignee: order.assignee || '待分配' })),
  async uploadFinishMedia(id, file, uploadId, onProgress) {
    for (const progress of [25, 60, 99]) { await new Promise(resolve => setTimeout(resolve, 120)); onProgress(progress); }
    if (file.name.includes('fail') && !failedOnce.has(uploadId)) { failedOnce.add(uploadId); throw new Error('测试上传失败，请重试'); }
    const order = fixtureOrders.find(item => item.id === id);
    const media = { key: `fixture/${uploadId}`, url: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' : 'image' };
    order.processedMedia.push(media); onProgress(100); return media;
  },
  invalidateReads() {},
};
