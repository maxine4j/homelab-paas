import { FunctionComponent, PropsWithChildren } from 'react';

interface PageContainerProps {
  title: string;
}

export const PageContainer: FunctionComponent<
  PropsWithChildren<PageContainerProps>
> = ({ title, children }) => {
  return (
    <div className="min-h-screen bg-[#121212] text-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8">
        <h1 className="text-3xl font-bold mb-6 text-white">{title}</h1>
        <div className="bg-[#1e1e1e] rounded-lg border border-white/10 p-6">
          {children}
        </div>
      </div>
    </div>
  );
};
