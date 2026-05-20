/// <reference types="vite/client" />

declare module "*.ttf?url" {
  const content: string;
  export default content;
}

declare module "*.csv?raw" {
  const content: string;
  export default content;
}

declare module "*.csv?url" {
  const content: string;
  export default content;
}
