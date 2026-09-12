// Wrangler/yargs otherwise treats a packaged Electron executable as an app with
// no script argument. In RUN_AS_NODE it has normal Node argv, including the script.
// --require propagates through Wrangler's own subprocess/refresh; no auth changes.
if(process.versions.electron&&process.env.ELECTRON_RUN_AS_NODE==='1')process.defaultApp=true;
