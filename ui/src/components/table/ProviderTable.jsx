/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Empty, Table, Button, Tooltip, Typography } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { useSelector } from '../../services/state/store';
import { providerDisplayName } from '../../services/jobs/providerName.js';

import './ProviderTable.less';

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
          // A named column, not an empty header. Two icon buttons under a blank heading are two
          // symbols nobody has to be able to read.
          title: t('provider.tableColumnActions'),
          dataIndex: 'tools',
          width: 120,
          render: (_, record) => (
            <div className="providerTable__actions">
              <Tooltip content={t('provider.tableEdit')}>
                <Button
                  theme="borderless"
                  type="tertiary"
                  icon={<IconEdit />}
                  aria-label={t('provider.tableEdit')}
                  onClick={() => onEdit(record)}
                />
              </Tooltip>
              <Tooltip content={t('provider.tableRemove')}>
                <Button
                  theme="borderless"
                  type="danger"
                  icon={<IconDelete />}
                  aria-label={t('provider.tableRemove')}
                  onClick={() => onRemove(record.url)}
                />
              </Tooltip>
            </div>
          ),
        },
      ]}
      dataSource={providerData}
    />
  );
}
