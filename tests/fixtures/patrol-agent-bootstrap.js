document.body.classList.add('app-ready');
sessionStorage.setItem('traffic-auth', JSON.stringify({ name: '测试用户', department: '政府办' }));
await import('/web/js/app.js');
