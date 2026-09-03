/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Empty, Table, Button, Typography } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { useSelector } from '../../services/state/store';
import { providerDisplayName } from '../../services/jobs/providerName.js';

export default function ProviderTable({ providerData = [], onRemove, onEdit } = {}) {
  const t = useTranslation();
  const providers = useSelector((state) => state.provider);
  const { Text } = Typography;
  return (
    <Table
      pagination={false}
      empty={<Empty description={t('provider.tableEmptyState')} />}
      columns={[
        {
          title: t('provider.tableColumnName'),
          dataIndex: 'name',
          // an entry saved over the API carries no name, so the row is resolved rather than read
          render: (_, entry) => providerDisplayName(entry, providers),
        },
        {
          title: t('provider.tableColumnUrl'),
          dataIndex: 'url',
          render: (_, data) => {
            return <Text link={{ href: data.url, target: '_blank' }}>{t('provider.tableOpenProvider')}</Text>;
          },
        },
        {
          title: '',
          dataIndex: 'tools',
          render: (_, record) => {
            return (
              <div style={{ float: 'right' }}>
                <Button type="secondary" icon={<IconEdit />} onClick={() => onEdit(record)} />
                <div style={{ display: 'inline-block', width: '16px' }} />
                <Button type="danger" icon={<IconDelete />} onClick={() => onRemove(record.url)} />
              </div>
            );
          },
        },
      ]}
      dataSource={providerData}
    />
  );
}
