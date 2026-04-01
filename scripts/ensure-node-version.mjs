const major = Number(process.versions.node.split(".")[0]);

if (major < 20) {
  console.error(
    `Project Memory Runtime requires Node 20 or later. Current version: ${process.versions.node}`
  );
  process.exit(1);
}
