import { FunctionComponent, PropsWithChildren } from 'react';

interface PageContainerProps {
  title?: string;
}

export const PageContainer: FunctionComponent<
  PropsWithChildren<PageContainerProps>
> = ({ children, title }) => {
  return (
    <div className="min-h-screen bg-[#121212] text-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8">
        <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
          {title && <h1 className="text-2xl font-bold mb-4">{title}</h1>}
          {children}
        </div>
      </div>
    </div>
  );
};
