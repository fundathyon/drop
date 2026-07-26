import { Fragment } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

export function ExplorerBreadcrumb({ path, onNavigate }: Props) {
  const segments = path ? path.split('/') : [];

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {segments.length === 0 ? (
            <BreadcrumbPage>Raíz</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <button type="button" className="cursor-pointer" onClick={() => onNavigate('')}>
                Raíz
              </button>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {segments.map((segment, i) => {
          const target = segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          return (
            <Fragment key={target}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      className="cursor-pointer"
                      onClick={() => onNavigate(target)}
                    >
                      {segment}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
