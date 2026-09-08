(() => {
  const COUNSELING_ASSET = '/data-core/assets/mode-counseling.webp';
  const WORK_ASSET = '/data-core/assets/mode-work.webp';
  const SIDEBAR_ASSET = '/data-core/assets/mode-sidebar.svg';

  function modeHomeIsActive() {
    return document.getElementById('view-mode-home')?.classList.contains('active') || false;
  }

  function syncBodyState() {
    document.body.classList.toggle('mode-home-artwork-active', modeHomeIsActive());
  }

  function setCard(mode, asset, href) {
    const card = document.querySelector(`[data-mode-card="${mode}"]`);
    if (!card) return;
    card.href = href;
    const image = card.querySelector('img');
    if (image) {
      image.src = asset;
      image.decoding = 'async';
      image.loading = 'eager';
    }
    if (!card.querySelector('.mode-artwork-arrow')) {
      const arrow = document.createElement('span');
      arrow.className = 'mode-artwork-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      card.appendChild(arrow);
    }
  }

  function addStyle() {
    if (document.getElementById('mode-home-artwork-style')) return;
    const style = document.createElement('style');
    style.id = 'mode-home-artwork-style';
    style.textContent = `
      body.mode-home-artwork-active .sidebar{
        background:
          linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.20)),
          url("${SIDEBAR_ASSET}") center/cover no-repeat;
        color:#17315e;
        border-right:1px solid rgba(148,163,184,.28);
      }
      body.mode-home-artwork-active .brand{
        margin:-4px -2px 12px;
        padding:10px 8px 18px;
        border-radius:14px;
        background:rgba(255,255,255,.58);
        backdrop-filter:blur(10px);
      }
      body.mode-home-artwork-active .brand strong{color:#0f172a;}
      body.mode-home-artwork-active .brand small{color:#667085;}
      body.mode-home-artwork-active [data-nav-scope="mode"] .nav-item{
        color:#17315e;
        background:rgba(255,255,255,.72);
        border:1px solid rgba(191,219,254,.75);
        box-shadow:0 8px 24px rgba(37,99,235,.08);
        backdrop-filter:blur(10px);
      }
      body.mode-home-artwork-active [data-nav-scope="mode"] .nav-item:hover,
      body.mode-home-artwork-active [data-nav-scope="mode"] .nav-item.active{
        color:#1d4ed8;
        background:rgba(239,246,255,.92);
      }
      body.mode-home-artwork-active .sidebar-bottom{
        padding:10px;
        margin-left:-2px;
        margin-right:-2px;
        border-radius:14px;
        background:rgba(255,255,255,.62);
        backdrop-filter:blur(10px);
      }
      body.mode-home-artwork-active .connection-card{
        background:rgba(255,255,255,.76);
        border-color:rgba(148,163,184,.30);
      }
      body.mode-home-artwork-active .connection-card strong{color:#1e293b;}
      body.mode-home-artwork-active .connection-card small{color:#64748b;}
      body.mode-home-artwork-active .back-link{color:#31558f;}
      body.mode-home-artwork-active .back-link:hover{color:#1d4ed8;}

      body.mode-home-artwork-active .mode-grid{
        gap:18px;
        padding-top:18px;
        align-items:stretch;
      }
      body.mode-home-artwork-active .mode-card{
        min-height:540px;
        border-radius:18px;
        border:1px solid #e1e8f2;
        background:#fff;
        box-shadow:0 18px 48px rgba(31,67,120,.10);
        transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease;
      }
      body.mode-home-artwork-active .mode-card:hover{
        transform:translateY(-4px);
        border-color:#bfdbfe;
        box-shadow:0 24px 60px rgba(37,99,235,.16);
      }
      body.mode-home-artwork-active .mode-card img{
        inset:0 0 auto 0;
        width:100%;
        height:calc(100% - 126px);
        object-fit:cover;
        object-position:center;
        transition:transform .35s ease;
      }
      body.mode-home-artwork-active .mode-card:hover img{transform:scale(1.012);}
      body.mode-home-artwork-active .mode-card::after{
        inset:auto 0 0;
        height:128px;
        background:linear-gradient(135deg,#315f9f 0%,#244b82 55%,#2b5a94 100%);
      }
      body.mode-home-artwork-active .mode-overlay{
        left:26px;
        right:92px;
        bottom:25px;
      }
      body.mode-home-artwork-active .mode-overlay strong{
        font-size:32px;
        letter-spacing:-.03em;
      }
      body.mode-home-artwork-active .mode-overlay small{
        margin-top:8px;
        color:#e6f0ff;
        font-size:14px;
      }
      .mode-artwork-arrow{
        position:absolute;
        right:26px;
        bottom:29px;
        z-index:3;
        width:50px;
        height:50px;
        display:grid;
        place-items:center;
        border:1.5px solid rgba(255,255,255,.9);
        border-radius:50%;
        color:#fff;
        font-size:27px;
        line-height:1;
        background:rgba(255,255,255,.08);
        transition:transform .2s ease,background .2s ease;
      }
      body.mode-home-artwork-active .mode-card:hover .mode-artwork-arrow{
        transform:translateX(3px);
        background:rgba(255,255,255,.16);
      }

      @media(max-width:980px){
        body.mode-home-artwork-active .mode-grid{grid-template-columns:1fr;}
        body.mode-home-artwork-active .mode-card{min-height:500px;}
      }
      @media(max-width:720px){
        body.mode-home-artwork-active .sidebar{
          background-image:linear-gradient(180deg,rgba(255,255,255,.76),rgba(255,255,255,.88)),url("${SIDEBAR_ASSET}");
        }
        body.mode-home-artwork-active .mode-card{min-height:430px;border-radius:14px;}
        body.mode-home-artwork-active .mode-card img{height:calc(100% - 118px);}
        body.mode-home-artwork-active .mode-card::after{height:120px;}
        body.mode-home-artwork-active .mode-overlay{left:20px;right:78px;bottom:21px;}
        body.mode-home-artwork-active .mode-overlay strong{font-size:27px;}
        .mode-artwork-arrow{right:20px;bottom:24px;width:46px;height:46px;}
      }
    `;
    document.head.appendChild(style);
  }

  function init() {
    addStyle();
    setCard('counseling', COUNSELING_ASSET, '/data-core/counseling');
    setCard('work', WORK_ASSET, '/data-core/work');
    syncBodyState();

    const view = document.getElementById('view-mode-home');
    if (view) {
      new MutationObserver(syncBodyState).observe(view, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();